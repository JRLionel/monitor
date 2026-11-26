import { io, Socket } from 'socket.io-client';
import type { SourceStatusSnapshot } from './api';

let socket: Socket | null = null;
let lastConnectError: string | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      lastConnectError = null;
      console.log('🔌 Socket connected:', socket?.id);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
    });

    socket.on('connect_error', (error) => {
      // 后端重启期间 Socket.io 会自动重连，同一错误只提示一次，避免刷屏
      const message = error.message || 'unknown error';
      if (message === lastConnectError) return;
      lastConnectError = message;
      console.warn(
        `🔌 Socket 连接失败（${window.location.origin}）：${message}。` +
          '请确认后端服务已启动（默认 http://localhost:3001），Socket.io 会自动重连。'
      );
    });
  }

  return socket;
}

export function subscribeToKeywords(keywords: string[]): void {
  const s = getSocket();
  s.emit('subscribe', keywords);
}

export function unsubscribeFromKeywords(keywords: string[]): void {
  const s = getSocket();
  s.emit('unsubscribe', keywords);
}

export interface HotspotEvent {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  importance: string;
  summary: string | null;
  keyword?: { text: string } | null;
}

export interface NotificationEvent {
  type: string;
  title: string;
  content: string;
  hotspotId?: string;
  importance?: string;
}

export function onNewHotspot(callback: (hotspot: HotspotEvent) => void): () => void {
  const s = getSocket();
  s.on('hotspot:new', callback);
  return () => s.off('hotspot:new', callback);
}

export function onNotification(callback: (notification: NotificationEvent) => void): () => void {
  const s = getSocket();
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

export function onSourceStatus(callback: (status: SourceStatusSnapshot) => void): () => void {
  const s = getSocket();
  s.on('source:status', callback);
  return () => s.off('source:status', callback);
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
