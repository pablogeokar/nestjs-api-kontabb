WITH certificados_ordenados AS (
	SELECT
		id,
		arquivo_key,
		ROW_NUMBER() OVER (
			PARTITION BY cliente_id
			ORDER BY
				CASE status
					WHEN 'ATIVO' THEN 0
					WHEN 'PRESTES_A_EXPIRAR' THEN 1
					ELSE 2
				END,
				criado_em DESC,
				id DESC
		) AS posicao
	FROM "certificados_digitais"
), certificados_removidos AS (
	DELETE FROM "certificados_digitais" certificados
	USING certificados_ordenados ordenados
	WHERE certificados.id = ordenados.id
		AND ordenados.posicao > 1
	RETURNING certificados.id, certificados.arquivo_key
)
INSERT INTO "storage_cleanup_jobs" ("object_key", "entidade_tipo", "entidade_id")
SELECT arquivo_key, 'CERTIFICADO_DIGITAL', id::text
FROM certificados_removidos
ON CONFLICT ("object_key") DO NOTHING;--> statement-breakpoint
DROP INDEX "uidx_certificados_cliente_ativo";--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_certificados_cliente" ON "certificados_digitais" USING btree ("cliente_id");
