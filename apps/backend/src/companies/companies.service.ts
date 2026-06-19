import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/create-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCompanyDto) {
    const exists = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('Ya existe una empresa con ese slug');
    return this.prisma.company.create({ data: dto });
  }

  findAll() {
    return this.prisma.company.findMany({
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
}
