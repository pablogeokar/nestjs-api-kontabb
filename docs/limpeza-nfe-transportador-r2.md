# Limpeza de NF-e recebidas apenas como transportador

O script `scripts/cleanup-nfe-transportador-r2.mjs` remove registros de NF-e do
DFe vinculados ao cliente `69537189000152` quando ele não é emitente nem
destinatário e o XML o identifica como transportador ou já está ausente no R2.
Também remove os XMLs e os DANFEs associados do bucket R2. O anexo de exemplo tem a chave
`31261111237265000124550010000039761550039765`.

O programa usa `DATABASE_URL` e as variáveis `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
`R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` do ambiente em que é executado. Rode
a partir da pasta `api`, com Node 20.9 ou superior e as dependências instaladas.
Implante antes a correção da importação DFe que rejeita NF-e em que o cliente
não é emitente nem destinatário, para impedir que as notas sejam recriadas.
Use o arquivo `.env` do ambiente de produção. O script mostra o nome do banco e
do bucket na prévia e vincula ambos ao manifesto. Na execução, ele confere que
continua conectado ao mesmo banco e à mesma conta e bucket R2.

## 1. Gerar a prévia

```sh
node --env-file=.env scripts/cleanup-nfe-transportador-r2.mjs --cnpj 69537189000152
```

O manifesto é criado automaticamente em
`api/data/limpeza-nfe-transportador-69537189000152.json`, com permissão `0600`.
Ele contém os IDs, as chaves de acesso e as chaves R2 selecionadas. Confira a
lista exibida e o arquivo. A prévia **não apaga** dados. Repetir o comando
atualiza a prévia enquanto a execução não começou. Um documento cujo XML já
esteja ausente no R2 também entra na seleção se não houver vínculo de emitente
ou destinatário com o cliente. A prévia indica `xmlStatus: "ausente"`; confira
que o bucket exibido é o correto antes de executar.

Se o ambiente ou o manifesto mudar após a prévia, a execução recusa o arquivo.
Rode a prévia novamente, sem `--execute`. O script preserva um manifesto inválido
ou de outro ambiente com sufixo `.anterior-...` e gera outro com o banco e bucket atuais. Não edite
manualmente o manifesto.

Documentos com eventos fiscais, decisões de itens, classificações aprendidas,
vínculos CIAP/SPED, fechamentos ou entregas na competência bloqueiam a limpeza.
O script também bloqueia chaves R2 fora da pasta do cliente ou referenciadas por
outro documento.

## 2. Executar

Depois de conferir a prévia e assegurar um backup recuperável do banco, repita
o comando com `--execute`:

```sh
node --env-file=.env scripts/cleanup-nfe-transportador-r2.mjs --cnpj 69537189000152 --execute
```

O script confere novamente o XML e os registros do banco contra o manifesto.
Se qualquer candidato mudou, interrompe a execução antes da exclusão. Os
documentos são apagados em uma transação; os itens são removidos pelo `ON DELETE
CASCADE`. Após o commit, o script apaga cada objeto R2 e atualiza o manifesto.
Como banco e R2 não compartilham transação, uma falha no R2 deixa as chaves
pendentes no manifesto e retorna código de saída `2`.

## 3. Retomar pendências do R2

Se o processo parar após o commit ou houver chaves pendentes, rode:

```sh
node --env-file=.env scripts/cleanup-nfe-transportador-r2.mjs --cnpj 69537189000152 --resume-r2
```

`--resume-r2` só remove objetos depois de conferir que os documentos do
manifesto já não existem no banco. A exclusão de um objeto ausente é segura
para repetição. Preserve o manifesto até a fase `COMPLETE`.

Os parâmetros `--manifest`, `--expect-database` e `--expect-bucket` continuam
disponíveis para quem quiser definir outro caminho ou exigir nomes específicos.
