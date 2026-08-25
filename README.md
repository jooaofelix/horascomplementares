# Horas Complementares — Psicologia / Técnicas de Observação

Sistema web para a turma registrar horas complementares junto com a **análise escrita** de cada
atividade: o aluno digita direto no navegador ou solta um arquivo `.txt` / `.md` no formulário, e o
texto fica guardado junto com as horas. O professor acompanha o total de cada aluno e coloca o selo
de validação nos registros que conferiu.

O mesmo código roda de dois jeitos:

| Onde | Para quê | Banco |
| --- | --- | --- |
| **No seu computador** (`npm start`) | testar, ou usar na rede da faculdade | SQLite em `data/horas.db` |
| **Cloudflare Workers** (`npm run deploy`) | link HTTPS no ar 24h para a turma | Cloudflare D1 |

## Rodar no seu computador

```bash
git clone https://github.com/jooaofelix/horascomplementares.git
cd horascomplementares
npm start
```

Abra <http://localhost:3000>. O banco é criado sozinho na primeira execução.

Requer **Node.js 22.5 ou mais novo** (usa o módulo `node:sqlite`) — confira com `node -v`. Nenhuma
dependência precisa ser instalada para rodar assim.

Para mudar a porta: `PORT=8080 npm start`.

## Publicar na internet (Cloudflare Workers + D1)

Precisa de uma conta na Cloudflare — o plano gratuito dá conta da turma.

```bash
npm install                 # baixa o wrangler (só para publicar)
npx wrangler login          # abre o navegador para autorizar
npm run banco:criar         # cria o banco D1
```

O `banco:criar` termina imprimindo um bloco com `database_id = "..."`. Copie esse id e cole no
`wrangler.toml`, no lugar de `PREENCHA_COM_O_ID_DO_SEU_BANCO`. Aproveite e troque, no mesmo arquivo,
o `CODIGO_PROFESSOR` por um código só seu.

```bash
npm run banco:migrar        # cria as tabelas no D1
npm run deploy              # publica
```

No fim o wrangler mostra o endereço, algo como `https://horas-complementares.SEU-SUBDOMINIO.workers.dev`.
É esse link que você passa para a turma.

Para atualizar depois de mexer no código, só `npm run deploy` de novo — os dados ficam no D1 e não
são tocados pelo deploy.

Quando uma mudança precisar de colunas novas no banco, os arquivos ficam em `migracoes/` e rodam uma
vez cada:

```bash
npx wrangler d1 execute horas-complementares --remote --file=migracoes/002-turmas-e-campos.sql
```

O banco local não precisa disso: ao iniciar, o `npm start` confere e cria sozinho as colunas que
faltarem.

Testar a versão Cloudflare na sua máquina antes de publicar:

```bash
npx wrangler d1 execute horas-complementares --local --file=src/esquema.sql   # uma vez
npx wrangler dev --local
```

> Os dois modos têm bancos separados: o que você cadastrar em `npm start` não aparece no site
> publicado, e vice-versa.

## Turmas

Uma professora pode atender várias turmas no mesmo sistema. Na aba **Minhas turmas** ela cria cada
turma com nome, período e **meta de horas própria**; o aluno escolhe a sua turma ao criar a conta (e
pode corrigir depois, em *Seus dados*).

O seletor **Turma que você está vendo** filtra de uma vez a lista de alunos, a fila de validação e a
planilha exportada — dá para fechar as horas de uma turma sem que as outras atrapalhem.

## Contas

- **Aluno**: cria a conta sozinho na tela de cadastro (nome, e-mail e senha).
- **Professor**: cria a conta na mesma tela, preenchendo o campo **código de professor**.

O código padrão é `tecnicas-de-observacao`. Troque antes de usar com a turma:

- rodando local: `CODIGO_PROFESSOR="algum-codigo-so-seu" npm start`
- publicado: edite `CODIGO_PROFESSOR` em `wrangler.toml` e rode `npm run deploy`

Pode haver mais de um professor — todos enxergam a turma inteira.

## Como o aluno usa

1. Preenche a ficha da atividade:

   | Campo | Obrigatório |
   | --- | --- |
   | Nome da atividade | sim |
   | Tipo de atividade (categoria) | sim |
   | Carga horária | sim |
   | Data da atividade | sim |
   | Data de término (para atividades de vários dias) | não |
   | Local / instituição | não |
   | Responsável no local (quem supervisionou) | não |
   | Comprovante (nº do certificado ou link) | não |

2. Escreve a análise no campo de texto **ou** arrasta um arquivo `.txt`/`.md` para a área pontilhada
   (o conteúdo entra no campo e ainda dá para editar antes de salvar; o nome do arquivo fica
   registrado junto).
3. Salva. As horas entram na hora no total **lançado**.

Categorias disponíveis: Observação em campo, Registro cursivo, Análise de material,
Leitura / fichamento, Supervisão, Seminário / evento, Extensão / projeto, Outro.

## Como funciona a validação

Toda hora declarada já conta no painel do aluno. O professor, na aba **Registros**, lê a análise e
marca *Validar horas* — com uma observação opcional que aparece para o aluno. O painel mostra os dois
totais lado a lado: **declarado** e **validado**.

Se o aluno editar uma atividade já validada, o selo cai e ela volta para a fila de pendentes — assim
o professor sempre valida a versão que está lá.

## O que o professor vê

- **Alunos**: panorama com horas validadas, lançadas e quantos registros faltam conferir por aluno,
  com a meta da turma de cada um.
- **Validar horas**: fila de atividades, com busca por aluno, atividade, local ou trecho da análise e
  filtro por status (começa mostrando só as pendentes).
- **Minhas turmas**: criar, renomear, ajustar a meta e excluir turmas (uma turma com alunos não é
  excluída por engano).
- **Ajustes**: título que aparece no topo e a meta padrão para alunos sem turma.

O botão **Exportar CSV** baixa uma planilha — o aluno leva só os próprios registros, o professor leva
a turma inteira (abre direto no Excel ou no Google Planilhas).

## Senhas

As senhas são guardadas com PBKDF2-SHA256 (nunca em texto puro), e o número de iterações fica gravado
dentro do próprio hash. O padrão é **10.000**, calibrado para caber no limite de 10 ms de CPU por
requisição do plano gratuito do Workers.

Se você usar o plano pago — ou só a versão local, que não tem esse limite — dá para endurecer as
senhas subindo `ITERACOES_SENHA` (em `wrangler.toml` ou como variável de ambiente) para `100000`.
Contas antigas continuam funcionando: cada senha é conferida com o número de iterações com que foi
criada, e passa a usar o novo valor quando a senha for trocada.

## Estrutura

```
server.js          servidor para rodar local (Node + node:sqlite)
worker.js          entrada do Cloudflare Workers
wrangler.toml      configuração do deploy (D1, assets, variáveis)
src/api.js         rotas e regras — não dependem do runtime
src/auth.js        senhas (PBKDF2 via Web Crypto) e sessões
src/sqlite.js      banco local + adaptador
src/d1.js          adaptador do Cloudflare D1
src/esquema.sql    esquema único, usado pelos dois bancos
migracoes/         alterações de banco para instalações que já existem
public/            interface (HTML, CSS e JavaScript sem framework)
test/api.test.js   testes de ponta a ponta da API
data/horas.db      banco local (criado ao rodar; fora do Git)
```

`src/api.js` recebe um banco já adaptado e devolve descrições de resposta, então as mesmas regras
valem nos dois ambientes — quem muda é só a camada de fora.

## Testes

```bash
npm test
```

Sobe o servidor com um banco em memória e cobre cadastro, login, registro de horas, validação,
permissões entre alunos, exportação e os erros de formulário.

## Backup

- **Local**: tudo mora em `data/horas.db`; pare o servidor e copie a pasta `data/`.
- **Publicado**: `npx wrangler d1 export horas-complementares --remote --output=backup.sql`.
- **Sempre**: o CSV exportado pela interface serve como cópia em formato aberto.
