import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';

// Asistente con IA (módulo «asistente_ia»): chat de consultas sobre los datos de la empresa.
// El acceso lo valida el servicio (módulo de la empresa + permiso «assistant»).
@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private service: AssistantService) {}

  @Get('status')
  status(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.status(user, companyId);
  }

  @Get('conversations')
  list(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listConversations(user, companyId);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getConversation(user, id);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteConversation(user, id);
  }

  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  ask(@CurrentUser() user: any, @Body() body: any) {
    return this.service.ask(user, { companyId: body?.companyId, conversationId: body?.conversationId, text: body?.text, viaVoice: !!body?.viaVoice });
  }

  @Post('transcribe')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  transcribe(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File, @Query('companyId') companyId?: string) {
    return this.service.transcribe(user, companyId, file);
  }
}
