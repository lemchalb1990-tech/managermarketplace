-- Invitaciones de usuarios a una empresa (por correo o enlace atado al correo).
-- CreateTable
CREATE TABLE "user_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL,
    "accessProfileId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "invitedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "invitedById" TEXT,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_invitations_tokenHash_key" ON "user_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "user_invitations_companyId_status_idx" ON "user_invitations"("companyId", "status");

-- CreateIndex
CREATE INDEX "user_invitations_email_status_idx" ON "user_invitations"("email", "status");

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

