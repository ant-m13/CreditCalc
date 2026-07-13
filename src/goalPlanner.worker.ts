import { buildGoalPlanPreview, buildGoalPlans } from './goalPlanner'
import type { GoalPlannerWorkerRequest, GoalPlannerWorkerResponse } from './goalPlannerRunner'

self.onmessage = (event: MessageEvent<GoalPlannerWorkerRequest>) => {
  const request = event.data
  try {
    const response: GoalPlannerWorkerResponse = request.kind === 'plan'
      ? { requestId: request.requestId, kind: 'plan', revision: request.snapshot.revision, result: buildGoalPlans(request.snapshot) }
      : { requestId: request.requestId, kind: 'preview', revision: request.snapshot.revision, result: buildGoalPlanPreview(request.snapshot, request.operations) }
    self.postMessage(response)
  } catch (error) {
    const response: GoalPlannerWorkerResponse = {
      requestId: request.requestId,
      kind: 'error',
      revision: request.snapshot.revision,
      error: error instanceof Error ? error.message : 'Не удалось рассчитать план достижения цели'
    }
    self.postMessage(response)
  }
}
