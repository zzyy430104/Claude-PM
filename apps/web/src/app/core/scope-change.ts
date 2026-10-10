import { Api } from './api';
import { ChangeRequest } from './models';

/** 计划批准后增删范围（工作包、需求）须引用已批准、尚未实施的范围变更 */
export async function approvedScopeChanges(api: Api, projectId: string) {
  const all = await api.get<ChangeRequest[]>(`/projects/${projectId}/changes`);
  return all.filter((c) => c.type === 'SCOPE' && c.status === 'APPROVED');
}
