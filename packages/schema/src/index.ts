export {
  AssumptionSchema,
  BriefSchema,
  ClarificationCategorySchema,
  DesignMapSchema,
  DesignNodeSchema,
  DesignNodeTypeSchema,
  DesignTaskRelationSchema,
  FunctionalRequirementSchema,
  PRDSchema,
  UIColorTokenSchema,
  UIComponentSchema,
  UIEffectTokenSchema,
  UIRadiusTokenSchema,
  UISpacingTokenSchema,
  UIKitSchema,
  UIKitFigmaExtractionSchema,
  UITypographyTokenSchema,
  PrioritySchema,
  RiskSchema,
  SourceLinkSchema,
  StageSchema,
  TechStackItemSchema,
  TaskNodeSchema,
  TaskStatusSchema,
  TaskTreeSchema,
  TaskTypeSchema,
  UserStorySchema
} from "./schemas";
export type { FunctionalRequirement, TaskNode } from "./schemas";
export { prdDocumentToMarkdown } from "./prd-to-markdown";
export { serializePrdToMarkdown, serializeTasksToMarkdown } from "./serializers";
export {
  buildLinearIssueMarkdown,
  formatFunctionalRequirementsAsAcceptanceChecklist,
  getInternalSpecIdFromTask,
  stripInternalSpecIdFromTitle
} from "./task-traceability";
export { validateWithSchema } from "./validators";
export type { ValidationFailure, ValidationResult, ValidationSuccess } from "./validators";

import { z } from "zod";
import {
  BriefSchema,
  ClarificationCategorySchema,
  DesignMapSchema,
  DesignNodeSchema,
  PRDSchema,
  PrioritySchema,
  StageSchema,
  UIKitSchema,
  TechStackItemSchema,
  TaskTreeSchema
} from "./schemas";

export type Brief = z.infer<typeof BriefSchema>;
export type PRD = z.infer<typeof PRDSchema>;
export type TaskTree = z.infer<typeof TaskTreeSchema>;
export type DesignMap = z.infer<typeof DesignMapSchema>;
export type DesignNode = z.infer<typeof DesignNodeSchema>;
export type UIKit = z.infer<typeof UIKitSchema>;
export type PipelineStage = z.infer<typeof StageSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type ClarificationCategory = z.infer<typeof ClarificationCategorySchema>;
