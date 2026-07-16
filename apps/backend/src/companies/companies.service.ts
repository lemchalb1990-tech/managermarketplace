import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/create-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCompanyDto) {
    const exists = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('Ya existe una empresa con ese slug');

    const { admin, ...companyData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: companyData });

      if (admin) {
        const emailExists = await tx.user.findUnique({ where: { email: admin.email } });
        if (emailExists) throw new ConflictException('El email del administrador ya está registrado');
        const hashed = await bcrypt.hash(admin.password, 10);
        await tx.user.create({
          data: {
            name: admin.name,
            email: admin.email,
            password: hashed,
            role: 'COMPANY_ADMIN',
            companyId: company.id,
          },
        });
      }

      return this.findOneInTx(tx, company.id);
    });
  }

  private async findOneInTx(tx: any, id: string) {
    return tx.company.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true, active: true } },
        _count: { select: { products: true } },
      },
    });
  }

  findAll() {
    return this.prisma.company.findMany({
      where: { active: true },
      include: { _count: { select: { users: true, products: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true, active: true } },
        connections: { select: { id: true, name: true, marketplace: true, active: true } },
        _count: { select: { products: true } },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: { active: false } });
  }

  // Borra el vínculo interno (Listing) de todos los productos de la empresa, sin llamar
  // a ninguna API de marketplace: las publicaciones siguen vivas en Mercado Libre (u otra
  // plataforma), el sistema solo deja de rastrearlas.
  async deleteAllListings(id: string) {
    await this.findOne(id);
    const result = await this.prisma.listing.deleteMany({
      where: { product: { companyId: id } },
    });
    return { deleted: result.count };
  }
}
