import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'afrocouture_dev_jwt_secret_key_super_secure_2026'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRATION', '15m')) as any,
        },
      }),
    }),
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}

