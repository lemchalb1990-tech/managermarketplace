import { Controller, Post, Body, Get, UseGuards, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { permissionsForUser } from '../common/permissions';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Sin token: qué opciones de ingreso mostrar (botón de Google, registro).
  @Get('config')
  config() {
    return this.authService.publicConfig();
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('google')
  google(@Body() body: { credential: string }) {
    return this.authService.googleLogin(body?.credential);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('google/signup')
  googleSignup(@Body() body: { signupToken: string; companyName: string; name?: string; phone?: string; rut?: string }) {
    return this.authService.googleSignup(body || ({} as any));
  }

  // Recuperación de contraseña: pocos intentos por minuto para evitar abusos.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgot(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body?.email);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('reset-password')
  checkReset(@Query('token') token: string) {
    return this.authService.checkResetToken(token);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  reset(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body?.token, body?.password);
  }

  // Invitación a una empresa: ver datos, aceptar creando contraseña o con Google (mismo correo).
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('invitation')
  invitation(@Query('token') token: string) {
    return this.authService.checkInvitation(token);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invitation/accept')
  acceptInvitation(@Body() body: { token: string; name?: string; password: string }) {
    return this.authService.acceptInvitation(body?.token, body || ({} as any));
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invitation/google')
  acceptInvitationGoogle(@Body() body: { token: string; credential: string }) {
    return this.authService.acceptInvitationGoogle(body?.token, body?.credential);
  }

  // Invitación para crear una empresa (la envía el Super Admin).
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('company-invitation')
  companyInvitation(@Query('token') token: string) {
    return this.authService.checkCompanyInvitation(token);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('company-invitation/accept')
  acceptCompanyInvitation(@Body() body: { token: string; name?: string; password: string; companyName?: string; phone?: string; rut?: string }) {
    return this.authService.acceptCompanyInvitation(body?.token, body || ({} as any));
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('company-invitation/google')
  acceptCompanyInvitationGoogle(@Body() body: { token: string; credential: string; companyName?: string; phone?: string; rut?: string }) {
    return this.authService.acceptCompanyInvitationGoogle(body?.token, body?.credential, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    // Permisos efectivos al día (el token guardado en el navegador puede traer los de su login).
    // La empresa va con las funciones de su plan comercial, igual que en el login.
    const { mlClientSecret: _s, subscriptionPlan, ...company } = user.company ?? {};
    return {
      ...user,
      company: user.company ? { ...company, planName: subscriptionPlan?.name ?? null, planFeatures: subscriptionPlan?.features ?? null } : null,
      permissions: permissionsForUser(user),
    };
  }
}
