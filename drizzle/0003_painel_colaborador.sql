-- Migration: Add employee portal auth columns to funcionarios_rh
-- Adds senha_hash for storing bcrypt/scrypt password hash
-- Adds primeiro_acesso flag (true = must change password on first login)

ALTER TABLE "funcionarios_rh"
ADD COLUMN "senha_hash" text,
ADD COLUMN "primeiro_acesso" boolean NOT NULL DEFAULT true;
