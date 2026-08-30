import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * Shared Redis connection config for BullMQ. Individual feature modules
 * (e.g. DocumentsModule) call `BullModule.registerQueue({ name: '...' })`
 * themselves — this module only sets up the shared connection once.
 *
 * `connection` must be a plain ioredis options object (host/port/etc) —
 * NOT `{ url }` (ioredis's RedisOptions has no `url` field, so that shape
 * is silently ignored and falls back to defaults) and NOT a shared
 * already-constructed IORedis instance (BullMQ/@nestjs-bullmq are built
 * around each Queue/Worker owning its own connection derived from these
 * options, not multiplexing one shared instance). Both of those are
 * documented-looking but wrong shapes that fail silently rather than
 * throwing — jobs just never get picked up.
 *
 * `maxRetriesPerRequest: null` is required for BullMQ Workers, which use
 * blocking Redis commands.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
