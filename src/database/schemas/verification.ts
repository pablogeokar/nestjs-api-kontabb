import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_verification_identifier').on(table.identifier),
    uniqueIndex('uidx_verification_value').on(table.value),
  ],
);
