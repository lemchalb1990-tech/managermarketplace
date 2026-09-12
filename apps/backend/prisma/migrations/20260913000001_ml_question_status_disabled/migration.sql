-- Mercado Libre incluye "DISABLED" entre los estados posibles de una pregunta
-- (junto a UNANSWERED, ANSWERED, CLOSED_UNANSWERED, UNDER_REVIEW, BANNED, DELETED).
ALTER TYPE "MlQuestionStatus" ADD VALUE IF NOT EXISTS 'DISABLED';
