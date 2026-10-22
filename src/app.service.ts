import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'afrocouture-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
