import { Module } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';

@Module({
  providers: [ReturnsService],
  controllers: [ReturnsController],
})
export class ReturnsModule {}
