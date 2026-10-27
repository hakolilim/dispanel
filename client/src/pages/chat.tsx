import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomEmoji, EmojiClickData } from 'emoji-picker-react';
import { useAuth } from '@/hooks/use-auth';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DiscordMessageContent } from '@/components/discord-message-content';
import { useToast } from '@/hooks/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { formatTime, generateGuildIconFallback, safeHttpUrl } from '@/lib/utils';
import { Hash, Send, Smile, Volume2, FileText } from 'lucide-react';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

interface Guild {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  memberCount: number | null;
  permissions: string | null;
}

interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parentId?: string;
}

interface Attachment {
  id: string;
  url: string;
  proxyUrl: string | null;
  name: string;
  contentType: string | null;
  width: number | null;
  height: number | null;
  size: number;
}

interface EmbedImage {
  url: string;
  proxyUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

interface Embed {
  type?: string;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  image?: EmbedImage | null;
  thumbnail?: EmbedImage | null;
}

interface Message {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
    bot: boolean;
  };
  timestamp: string;
  channelId: string;
  guildId?: string;
  attachments?: Attachment[];
  embeds?: Embed[];
}

interface GuildEmoji {
  id: string;
  name: string;
  animated: boolean;
  url: string;
}

interface GuildEmojisResponse {
  success: boolean;
  emojis: GuildEmoji[];
}

interface ChannelMessagesResponse {
  success: boolean;
  messages: Message[];
  hasMore: boolean;
  error?: string;
}

const MESSAGE_PAGE_SIZE = 50;

function mergeMessages(...messageGroups: Message[][]): Message[] {
  const seenMessageIds = new Set<string>();

  return messageGroups.flat().filter(message => {
    if (seenMessageIds.has(message.id)) {
      return false;
    }

    seenMessageIds.add(message.id);
    return true;
  });
}

async function fetchChannelMessages(channelId: string, before?: string): Promise<ChannelMessagesResponse> {
  const searchParams = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
  if (before) {
    searchParams.set('before', before);
  }

  const response = await fetch(`/api/bot/channels/${channelId}/messages?${searchParams}`, {
    credentials: 'include',
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to load messages');
  }

  return data;
}

export default function ChatPage() {
  const { isAuthenticated, botId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useWebSocket(botId || undefined);
  
  const [selectedGuild, setSelectedGuild] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [messageContent, setMessageContent] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const shouldScrollToBottomRef = useRef(false);
  const olderMessagesRequestIdRef = useRef(0);
  const isLoadingOlderMessagesRef = useRef(false);
  const activeChannelRef = useRef(selectedChannel);
  activeChannelRef.current = selectedChannel;

  // Fetch guilds
  const { data: guildsData } = useQuery({
    queryKey: ['/api/bot/guilds'],
    enabled: !!botId,
  });

  const guilds: Guild[] = (guildsData as any)?.guilds || [];
  const selectedGuildData = guilds.find(g => g.guildId === selectedGuild);

  const {
    data: guildEmojisData,
    isLoading: isLoadingEmojis,
    isError: hasEmojiError,
  } = useQuery<GuildEmojisResponse>({
    queryKey: ['/api/bot/guilds', selectedGuild, 'emojis'],
    enabled: !!selectedGuild,
    queryFn: async () => {
      const response = await fetch(`/api/bot/guilds/${selectedGuild}/emojis`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load server emojis');
      }

      return response.json();
    },
  });

  const customEmojis = useMemo<CustomEmoji[]>(() => {
    const group = selectedGuildData?.guildName || 'Server emojis';
    return (guildEmojisData?.emojis || []).map(emoji => ({
      id: emoji.id,
      names: [emoji.name],
      imgUrl: emoji.url,
      group,
    }));
  }, [guildEmojisData?.emojis, selectedGuildData?.guildName]);

  // Fetch channels for selected guild
  useEffect(() => {
    setSelectedChannel('');
    setChannels([]);
    setIsEmojiPickerOpen(false);

    if (!selectedGuild) {
      return;
    }

    setIsLoadingChannels(true);
    fetch(`/api/bot/guilds/${selectedGuild}/channels`, {
      credentials: 'include',
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setChannels(data.channels || []);
        } else {
          toast({
            title: "Error",
            description: "Failed to load channels",
            variant: "destructive",
          });
        }
      })
      .catch(() => {
        toast({
          title: "Error",
          description: "Failed to load channels",
          variant: "destructive",
        });
      })
      .finally(() => {
        setIsLoadingChannels(false);
      });
  }, [selectedGuild, toast]);

  // Fetch messages for selected channel
  useEffect(() => {
    const requestId = ++olderMessagesRequestIdRef.current;

    if (!selectedChannel) {
      setMessages([]);
      setHasMoreMessages(false);
      setIsLoadingOlderMessages(false);
      setIsLoadingMessages(false);
      isLoadingOlderMessagesRef.current = false;
      return;
    }

    let cancelled = false;
    setIsLoadingMessages(true);
    setIsLoadingOlderMessages(false);
    isLoadingOlderMessagesRef.current = false;
    setHasMoreMessages(false);
    setMessages([]);

    fetchChannelMessages(selectedChannel)
      .then(data => {
        if (!cancelled) {
          shouldScrollToBottomRef.current = true;
          setMessages(data.messages);
          setHasMoreMessages(data.hasMore);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          toast({
            title: "Error",
            description: error.message || "Failed to load messages",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled && requestId === olderMessagesRequestIdRef.current) {
          setIsLoadingMessages(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChannel, toast]);

  // Scroll to the newest message only for an initial channel load or after sending.
  useEffect(() => {
    if (shouldScrollToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      shouldScrollToBottomRef.current = false;
    }
  }, [messages]);

  const loadOlderMessages = async () => {
    const channelId = selectedChannel;
    const before = messages[0]?.id;

    if (!channelId || !before || !hasMoreMessages || isLoadingOlderMessagesRef.current) {
      return;
    }

    const requestId = ++olderMessagesRequestIdRef.current;
    const viewport = messagesViewportRef.current;
    const previousScrollHeight = viewport?.scrollHeight ?? 0;
    const previousScrollTop = viewport?.scrollTop ?? 0;

    isLoadingOlderMessagesRef.current = true;
    setIsLoadingOlderMessages(true);

    try {
      const data = await fetchChannelMessages(channelId, before);
      if (requestId !== olderMessagesRequestIdRef.current || activeChannelRef.current !== channelId) {
        return;
      }

      setMessages(currentMessages => mergeMessages(data.messages, currentMessages));
      setHasMoreMessages(data.hasMore);

      requestAnimationFrame(() => {
        if (activeChannelRef.current === channelId && viewport) {
          viewport.scrollTop = previousScrollTop + viewport.scrollHeight - previousScrollHeight;
        }
      });
    } catch (error: any) {
      if (requestId === olderMessagesRequestIdRef.current && activeChannelRef.current === channelId) {
        toast({
          title: "Error",
          description: error.message || "Failed to load older messages",
          variant: "destructive",
        });
      }
    } finally {
      if (requestId === olderMessagesRequestIdRef.current) {
        isLoadingOlderMessagesRef.current = false;
        setIsLoadingOlderMessages(false);
      }
    }
  };

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current;
    if (viewport && viewport.scrollTop < 80) {
      void loadOlderMessages();
    }
  };

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, channelId }: { content: string; channelId: string }) => {
      const response = await fetch('/api/bot/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          targetType: 'channel',
          targetId: channelId,
          content,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to send message');
      }
      
      return await response.json();
    },
    onSuccess: (_data, variables) => {
      setMessageContent('');
      selectionRef.current = { start: 0, end: 0 };
      toast({
        title: "Message sent",
        description: "Your message has been sent successfully",
      });
      
      // Refresh messages after sending
      setTimeout(() => {
        const channelId = variables.channelId;
        if (activeChannelRef.current === channelId) {
          fetchChannelMessages(channelId)
            .then(data => {
              if (activeChannelRef.current === channelId) {
                shouldScrollToBottomRef.current = true;
                setMessages(currentMessages => mergeMessages(currentMessages, data.messages));
              }
            })
            .catch(() => {
              // The message was sent successfully; a later refresh can recover the timeline.
            });
        }
      }, 1000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!messageContent.trim()) return;
    if (!selectedChannel) {
      toast({
        title: "Error",
        description: "Please select a channel first",
        variant: "destructive",
      });
      return;
    }

    sendMessageMutation.mutate({
      content: messageContent,
      channelId: selectedChannel,
    });
  };

  const selectedChannelData = channels.find(c => c.id === selectedChannel);

  const rememberSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  };

  const insertEmoji = (emojiData: EmojiClickData) => {
    let valueToInsert = emojiData.emoji;

    if (emojiData.isCustom) {
      const guildEmoji = guildEmojisData?.emojis.find(emoji => emoji.id === emojiData.unified);
      if (!guildEmoji) return;

      valueToInsert = `<${guildEmoji.animated ? 'a' : ''}:${guildEmoji.name}:${guildEmoji.id}>`;
    }

    const { start, end } = selectionRef.current;
    setMessageContent(current => (
      current.slice(0, start) + valueToInsert + current.slice(end)
    ));

    const nextPosition = start + valueToInsert.length;
    selectionRef.current = { start: nextPosition, end: nextPosition };
  };

  const restoreTextareaFocus = () => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
    });
  };

  // Group channels by category
  const textChannels = channels.filter(c => c.type === 0).sort((a, b) => a.position - b.position);
  const voiceChannels = channels.filter(c => c.type === 2).sort((a, b) => a.position - b.position);

  return (
    <div className="min-h-screen bg-[#36393f]">
      <Header
        title="Live Chat"
        description="Chat with your Discord communities in real-time"
      />
      
      <div className="flex h-[calc(100vh-80px)]">
        {/* Server & Channel Sidebar */}
        <div className="w-80 bg-[#2f3136] border-r border-[#202225] flex flex-col">
          {/* Server Selection */}
          <div className="p-4 border-b border-[#202225]">
            <Select value={selectedGuild} onValueChange={setSelectedGuild}>
              <SelectTrigger className="bg-[#40444b] border-[#202225] text-white">
                <SelectValue placeholder="Select a server..." />
              </SelectTrigger>
              <SelectContent className="bg-[#40444b] border-[#202225] text-white">
                {guilds.map((guild) => (
                  <SelectItem key={guild.guildId} value={guild.guildId}>
                    <div className="flex items-center gap-2">
                      {guild.guildIcon ? (
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={`https://cdn.discordapp.com/icons/${guild.guildId}/${guild.guildIcon}.png`} />
                          <AvatarFallback className="text-xs bg-[#5865f2] text-white">
                            {generateGuildIconFallback(guild.guildName)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-[#5865f2] flex items-center justify-center text-xs text-white font-medium">
                          {generateGuildIconFallback(guild.guildName)}
                        </div>
                      )}
                      <span className="truncate">{guild.guildName}</span>
                      {guild.memberCount && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {guild.memberCount}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Channel List */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-2">
                {selectedGuild ? (
                  isLoadingChannels ? (
                    <div className="text-center text-[#b9bbbe] py-8">Loading channels...</div>
                  ) : (
                    <div className="space-y-4">
                      {/* Text Channels */}
                      {textChannels.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#8e9297] uppercase tracking-wide">
                            <Hash className="w-3 h-3" />
                            Text Channels
                          </div>
                          <div className="space-y-0.5">
                            {textChannels.map((channel) => (
                              <button
                                key={channel.id}
                                onClick={() => setSelectedChannel(channel.id)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                                  selectedChannel === channel.id
                                    ? 'bg-[#393c43] text-white'
                                    : 'text-[#8e9297] hover:text-[#dcddde] hover:bg-[#34373c]'
                                }`}
                              >
                                <Hash className="w-4 h-4 text-[#8e9297]" />
                                <span className="truncate">{channel.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Voice Channels */}
                      {voiceChannels.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#8e9297] uppercase tracking-wide">
                            <Volume2 className="w-3 h-3" />
                            Voice Channels
                          </div>
                          <div className="space-y-0.5">
                            {voiceChannels.map((channel) => (
                              <div
                                key={channel.id}
                                className="flex items-center gap-2 px-2 py-1.5 text-sm text-[#8e9297]"
                              >
                                <Volume2 className="w-4 h-4 text-[#8e9297]" />
                                <span className="truncate">{channel.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {textChannels.length === 0 && voiceChannels.length === 0 && (
                        <div className="text-center text-[#8e9297] py-8">
                          No channels available
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="text-center text-[#8e9297] py-8">
                    Select a server to view channels
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Channel Header */}
          {selectedChannelData && selectedGuildData && (
            <div className="h-12 bg-[#36393f] border-b border-[#202225] flex items-center px-4">
              <Hash className="w-5 h-5 text-[#8e9297] mr-2" />
              <span className="font-semibold text-white">{selectedChannelData.name}</span>
              <Separator orientation="vertical" className="mx-4 h-6 bg-[#40444b]" />
              <span className="text-sm text-[#b9bbbe]">
                {selectedGuildData.guildName}
              </span>
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea
              className="h-full"
              viewportRef={messagesViewportRef}
              onScrollCapture={handleMessagesScroll}
            >
              <div className="p-4">
                {selectedChannel ? (
                  isLoadingMessages ? (
                    <div className="text-center text-[#b9bbbe] py-8">Loading messages...</div>
                  ) : (
                    <div className="space-y-4">
                      {isLoadingOlderMessages && (
                        <div className="text-center text-sm text-[#b9bbbe] py-2">
                          Loading older messages...
                        </div>
                      )}
                      {messages.length > 0 ? (
                        messages.map((message, index) => {
                          const showAvatar = index === 0 || messages[index - 1]?.author.id !== message.author.id;
                          const isBot = message.author.bot;
                          
                          return (
                            <div key={message.id} className={`flex gap-3 ${showAvatar ? '' : 'ml-12'}`}>
                              {showAvatar && (
                                <Avatar className="w-8 h-8 mt-0.5">
                                  <AvatarImage 
                                    src={message.author.avatar 
                                      ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png`
                                      : undefined
                                    } 
                                  />
                                  <AvatarFallback className="bg-[#5865f2] text-white text-xs">
                                    {message.author.username.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                              <div className="flex-1 min-w-0">
                                {showAvatar && (
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-white">
                                      {message.author.username}
                                    </span>
                                    {isBot && (
                                      <Badge variant="secondary" className="text-xs bg-[#5865f2] text-white">
                                        BOT
                                      </Badge>
                                    )}
                                    <span className="text-xs text-[#72767d]">
                                      {formatTime(message.timestamp)}
                                    </span>
                                  </div>
                                )}
                                {message.content && (
                                  <DiscordMessageContent
                                    content={message.content}
                                    className="text-[#dcddde]"
                                  />
                                )}

                                {/* Image & file attachments */}
                                {message.attachments && message.attachments.length > 0 && (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {message.attachments.map((attachment) => {
                                      const attachmentUrl = safeHttpUrl(attachment.url);
                                      if (!attachmentUrl) return null;

                                      return attachment.contentType?.startsWith('image/') ? (
                                        <a
                                          key={attachment.id}
                                          href={attachmentUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block w-fit"
                                        >
                                          <img
                                            src={safeHttpUrl(attachment.proxyUrl) || attachmentUrl}
                                            alt={attachment.name}
                                            className="max-w-sm max-h-80 rounded-lg border border-[#202225] object-contain"
                                            loading="lazy"
                                          />
                                        </a>
                                      ) : (
                                        <a
                                          key={attachment.id}
                                          href={attachmentUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-2 w-fit max-w-sm px-3 py-2 rounded-lg bg-[#2f3136] border border-[#202225] text-sm text-[#00a8fc] hover:bg-[#34373c] transition-colors"
                                        >
                                          <FileText className="w-4 h-4 flex-shrink-0" />
                                          <span className="truncate">{attachment.name}</span>
                                        </a>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Embedded images (link previews / bot embeds) */}
                                {message.embeds && message.embeds.length > 0 && (
                                  <div className="mt-2 flex flex-col gap-2">
                                    {message.embeds.map((embed, embedIndex) => {
                                      const embedImage = embed.image || embed.thumbnail;
                                      if (!embedImage) return null;
                                      const imageUrl = safeHttpUrl(embedImage.proxyUrl) || safeHttpUrl(embedImage.url);
                                      if (!imageUrl) return null;
                                      const targetUrl = safeHttpUrl(embed.url) || imageUrl;
                                      return (
                                        <a
                                          key={embedIndex}
                                          href={targetUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block w-fit"
                                        >
                                          <img
                                            src={imageUrl}
                                            alt={embed.title || 'embed image'}
                                            className="max-w-sm max-h-80 rounded-lg border border-[#202225] object-contain"
                                            loading="lazy"
                                          />
                                        </a>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center text-[#8e9297] py-8">
                          No messages in this channel yet
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  )
                ) : (
                  <div className="text-center text-[#8e9297] py-8">
                    Select a channel to view messages
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Message Input */}
          {selectedChannel && (
            <div className="p-4 bg-[#36393f] border-t border-[#202225]">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <div className="flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    onSelect={rememberSelection}
                    onClick={rememberSelection}
                    onKeyUp={rememberSelection}
                    onBlur={rememberSelection}
                    placeholder={`Message #${selectedChannelData?.name || 'channel'}`}
                    className="min-h-[44px] max-h-32 bg-[#40444b] border-[#202225] text-white placeholder:text-[#72767d] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                  />
                </div>
                <Popover open={isEmojiPickerOpen} onOpenChange={setIsEmojiPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Choose an emoji"
                      className="h-11 w-11 text-[#b9bbbe] hover:bg-[#40444b] hover:text-white"
                      onMouseDown={rememberSelection}
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="end"
                    className="w-auto overflow-hidden border-[#202225] bg-[#2f3136] p-0"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      restoreTextareaFocus();
                    }}
                  >
                    {isLoadingEmojis && (
                      <div className="border-b border-[#202225] px-3 py-2 text-xs text-[#b9bbbe]">
                        Loading server emojis...
                      </div>
                    )}
                    {hasEmojiError && (
                      <div className="border-b border-[#202225] px-3 py-2 text-xs text-[#faa61a]">
                        Server emojis are unavailable. Standard emojis still work.
                      </div>
                    )}
                    <Suspense
                      fallback={(
                        <div className="flex h-[400px] w-[350px] items-center justify-center text-sm text-[#b9bbbe]">
                          Loading emoji picker...
                        </div>
                      )}
                    >
                      <EmojiPicker
                        colorScheme="dark"
                        width={350}
                        height={400}
                        lazyLoadEmojis
                        customEmojis={customEmojis}
                        previewConfig={{ showPreview: false }}
                        searchPlaceholder="Search emoji..."
                        onEmojiClick={insertEmoji}
                      />
                    </Suspense>
                  </PopoverContent>
                </Popover>
                <Button
                  type="submit"
                  disabled={!messageContent.trim() || sendMessageMutation.isPending}
                  className="bg-[#5865f2] hover:bg-[#4752c4] text-white h-11"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
