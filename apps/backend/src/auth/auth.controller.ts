import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
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
