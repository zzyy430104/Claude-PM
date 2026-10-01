import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { HandoverStatus } from '../generated/prisma/enums.js';
import { CurrentUser } from '../common/decorators.js';
import { requireTenantId } from '../common/auth.types.js';
import type { AuthUser } from '../common/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfirmHandoverDto, FaiDto, HandoverDto, OrderDto, PurchaseItemDto, ReceiveDto, SettleDto, UpdateFaiDto, UpdatePurchaseItemDto } from './dto.js';
import { FaiService } from './fai.service.js';
import { HandoverService } from './handover.service.js';
import { PurchaseService } from './purchase.service.js';

const P = () => Param('id', ParseUUIDPipe);
const U = (name: string) => Param(name, ParseUUIDPipe);

/** 采购计划、FAI、售后交接 */
@Controller()
export class DeliveryController {
  constructor(private readonly purchase: PurchaseService, private readonly fai: FaiService, private readonly handover: HandoverService, private readonly prisma: PrismaService) {}

  @Get('projects/:id/purchase-plan') plan(@CurrentUser() u: AuthUser, @P() id: string) { return this.purchase.get(u, id); }
  @Post('projects/:id/purchase-plan/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @P() id: string) { return this.purchase.approve(u, id); }
  @Post('projects/:id/purchase-items') create(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: PurchaseItemDto) { return this.purchase.create(u, id, dto); }
  @Patch('projects/:id/purchase-items/:iid') update(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string, @Body() dto: UpdatePurchaseItemDto) { return this.purchase.update(u, id, iid, dto); }
  @Delete('projects/:id/purchase-items/:iid') remove(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string) { return this.purchase.remove(u, id, iid); }
  @Post('projects/:id/purchase-items/:iid/order') @HttpCode(200) order(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string, @Body() dto: OrderDto) { return this.purchase.order(u, id, iid, dto); }
  @Post('projects/:id/purchase-items/:iid/receive') @HttpCode(200) receive(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string, @Body() dto: ReceiveDto) { return this.purchase.receive(u, id, iid, dto); }
  @Post('projects/:id/purchase-items/:iid/settle') @HttpCode(200) settle(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string, @Body() dto: SettleDto) { return this.purchase.settle(u, id, iid, dto); }
  @Post('projects/:id/purchase-items/:iid/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @P() id: string, @U('iid') iid: string) { return this.purchase.cancel(u, id, iid); }

  @Get('projects/:id/fai') faiList(@CurrentUser() u: AuthUser, @P() id: string) { return this.fai.list(u, id); }
  @Post('projects/:id/fai') faiCreate(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: FaiDto) { return this.fai.create(u, id, dto); }
  @Patch('projects/:id/fai/:fid') faiUpdate(@CurrentUser() u: AuthUser, @P() id: string, @U('fid') fid: string, @Body() dto: UpdateFaiDto) { return this.fai.update(u, id, fid, dto); }
  @Delete('projects/:id/fai/:fid') faiRemove(@CurrentUser() u: AuthUser, @P() id: string, @U('fid') fid: string) { return this.fai.remove(u, id, fid); }

  @Get('projects/:id/handover') ho(@CurrentUser() u: AuthUser, @P() id: string) { return this.handover.get(u, id); }
  @Put('projects/:id/handover') hoSave(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: HandoverDto) { return this.handover.save(u, id, dto); }
  @Post('projects/:id/handover/submit') @HttpCode(200) hoSubmit(@CurrentUser() u: AuthUser, @P() id: string) { return this.handover.submit(u, id); }
  @Post('projects/:id/handover/withdraw') @HttpCode(200) hoWithdraw(@CurrentUser() u: AuthUser, @P() id: string) { return this.handover.withdraw(u, id); }
  @Post('projects/:id/handover/confirm') @HttpCode(200) hoConfirm(@CurrentUser() u: AuthUser, @P() id: string, @Body() dto: ConfirmHandoverDto) { return this.handover.confirm(u, id, dto); }
  /** 等我确认的售后交接（接收人往往不是项目成员） */
  @Get('handovers/mine') async mine(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.handover.findMany({ where: { tenantId: requireTenantId(u), receiverId: u.id, status: { in: [HandoverStatus.PENDING, HandoverStatus.CONFIRMED] } }, orderBy: { submittedAt: 'desc' } });
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true, name: true } });
    return rows.map((r) => ({ projectId: r.projectId, project: projects.find((p) => p.id === r.projectId), status: r.status, submittedAt: r.submittedAt, confirmedAt: r.confirmedAt }));
  }
}
