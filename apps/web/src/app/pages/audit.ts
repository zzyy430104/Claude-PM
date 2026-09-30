import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import { API } from '../core/auth.service';
import { AuditRow } from '../core/models';

const PAGE = 50;

@Component({
  selector: 'app-audit',
  imports: [DatePipe, MatButtonModule, MatTableModule],
  template: `
    <div class="page">
      <h1>审计日志</h1>
      <p>记录只增不改，数据库层禁止修改和删除。</p>
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="createdAt"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let r">{{ r.createdAt | date: 'yyyy-MM-dd HH:mm:ss' }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>操作</th><td mat-cell *matCellDef="let r">{{ r.action }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>对象</th><td mat-cell *matCellDef="let r">{{ r.entity }} {{ r.entityId }}</td></ng-container>
        <ng-container matColumnDef="actor"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let r">{{ r.actorId ?? '系统' }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
      @if (more()) { <button mat-button (click)="load()">加载更多</button> }
    </div>
  `,
})
export class AuditPage {
  private readonly http = inject(HttpClient);
  readonly cols = ['createdAt', 'action', 'entity', 'actor'];
  readonly rows = signal<AuditRow[]>([]);
  readonly more = signal(false);

  constructor() {
    void this.load();
  }

  async load() {
    const last = this.rows().at(-1);
    const cursor = last ? `&cursor=${last.id}` : '';
    const batch = await firstValueFrom(
      this.http.get<AuditRow[]>(`${API}/audit-logs?limit=${PAGE}${cursor}`),
    );
    this.rows.update((r) => [...r, ...batch]);
    this.more.set(batch.length === PAGE);
  }
}
