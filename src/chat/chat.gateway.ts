import { HttpException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { ChatService, roomFor } from './chat.service.js';
import { User } from '../users/entities/user.entity.js';
import type { JwtPayload } from '../types/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOOD_LIMIT = 20;
const FLOOD_WINDOW_MS = 10_000;

/** Same origins main.ts allows for HTTP; read per request so FRONTEND_URL from .env applies. */
function allowedOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.FRONTEND_URL ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ];
  // Non-browser clients (no Origin header) are allowed; they still need a valid token.
  callback(null, !origin || allowed.includes(origin));
}

type Ack = { ok: true; [key: string]: unknown } | { ok: false; error: string };

interface ChatSocketData {
  user: User;
  sendTimes: number[];
}

const errorMessage = (err: unknown) =>
  err instanceof HttpException
    ? (() => {
        const res = err.getResponse();
        const msg = typeof res === 'string' ? res : (res as { message?: string | string[] }).message;
        return Array.isArray(msg) ? msg[0] : (msg ?? err.message);
      })()
    : 'Something went wrong. Please try again.';

/**
 * Live order chat. Clients connect to /chat with `auth: { token: <access JWT> }`,
 * `join_order` an order they belong to, then receive `new_message`, `typing` and `order_updated`.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: allowedOrigin, credentials: true } })
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  afterInit(server: Namespace) {
    this.chat.attachServer(server);
    // Authenticate during the handshake so unauthenticated clients never connect.
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          (socket.data as ChatSocketData) = { user, sendTimes: [] };
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  private async authenticate(socket: Socket): Promise<User> {
    const header = socket.handshake.headers.authorization;
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new Error('missing token');

    const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.status !== 'active' || !user.emailVerified) throw new Error('inactive user');
    return user;
  }

  private data(client: Socket): ChatSocketData {
    return client.data as ChatSocketData;
  }

  @SubscribeMessage('join_order')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: string }): Promise<Ack> {
    const orderId = body?.orderId;
    if (!orderId || !UUID.test(orderId)) return { ok: false, error: 'A valid orderId is required.' };
    try {
      await this.chat.requireMember(orderId, this.data(client).user.id);
      await client.join(roomFor(orderId));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  @SubscribeMessage('leave_order')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: string }): Promise<Ack> {
    if (body?.orderId) await client.leave(roomFor(body.orderId));
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId?: string; content?: string; attachmentUrl?: string },
  ): Promise<Ack> {
    const orderId = body?.orderId;
    if (!orderId || !UUID.test(orderId)) return { ok: false, error: 'A valid orderId is required.' };

    // Simple per-connection flood guard: at most FLOOD_LIMIT messages per window.
    const data = this.data(client);
    const now = Date.now();
    data.sendTimes = data.sendTimes.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (data.sendTimes.length >= FLOOD_LIMIT) {
      return { ok: false, error: 'You are sending messages too quickly. Wait a few seconds.' };
    }
    data.sendTimes.push(now);

    try {
      const message = await this.chat.send(orderId, data.user.id, {
        content: typeof body.content === 'string' ? body.content : undefined,
        attachmentUrl: typeof body.attachmentUrl === 'string' ? body.attachmentUrl : undefined,
      });
      return { ok: true, message };
    } catch (err) {
      if (!(err instanceof HttpException)) this.logger.error('send_message failed', err as Error);
      return { ok: false, error: errorMessage(err) };
    }
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: string }): void {
    const orderId = body?.orderId;
    const room = orderId ? roomFor(orderId) : null;
    // Only relay for rooms this socket actually joined (i.e. membership was checked).
    if (!room || !client.rooms.has(room)) return;
    client.to(room).emit('typing', { orderId, userId: this.data(client).user.id });
  }
}
