# Horas Complementares

Sistema web para alunos registrarem horas complementares junto com a **análise escrita** de cada
atividade: o aluno digita direto no navegador ou anexa um arquivo `.txt` / `.md`, e o texto fica
guardado junto com as horas. O professor acompanha o total de cada aluno e coloca o selo de
validação nos registros que conferiu.

Cada professor é dono das próprias turmas: ele se cadastra sozinho, cria as turmas e recebe um
**código** por turma. Só quem tem o código entra, e um professor nunca enxerga os alunos de outro —
dá para vários professores usarem a mesma instalação.

A tela foi desenhada primeiro para o celular, que é onde o aluno lança as horas, e se abre em
colunas no computador.

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
`wrangler.toml`, no lugar de `PREENCHA_COM_O_ID_DO_SEU_BANCO`.

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
npx wrangler d1 execute horas-complementares --remote --file=migracoes/003-saas-multiprofessor.sql
npx wrangler d1 execute horas-complementares --remote --file=migracoes/004-convites-de-professor.sql
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

## Turmas e códigos

Na aba **Turmas**, o professor cria cada turma com nome, período e **meta de horas própria**. Cada
turma ganha um código de 6 caracteres (ex.: `9PFQ3K`), sem letras ambíguas para não confundir na
hora de ditar em sala. O botão **Copiar convite** copia o endereço do sistema junto com o código,
pronto para colar no grupo da turma.

O aluno digita esse código ao criar a conta — antes de confirmar, a tela mostra em qual turma e com
qual professor ele vai entrar. Se errar de turma, ele mesmo corrige em *Seus dados* com o código
certo.

Com mais de uma turma aparece o seletor **Turma que você está vendo**, que filtra de uma vez a lista
de alunos, a fila de validação e a planilha exportada.

## Contas

- **Aluno**: escolhe *Sou aluno(a)* na tela de cadastro e informa o código da turma.
- **Professor**: escolhe *Sou professor(a)* e informa um **código de convite**.

O primeiro professor de uma instalação nova entra sem convite — não haveria quem o convidasse — e é
ele quem passa a poder convidar os outros. Na aba **Convites** ele gera códigos de uso único, cada um
com uma anotação para lembrar de quem é, copia o convite pronto para enviar e revoga os que ainda não
foram usados. A lista mostra quem usou cada convite e quando.

Quem entra por convite vira professor pleno das próprias turmas, mas não gera convites: a porta
continua sendo só sua. Para dar essa permissão a outra pessoa:

```bash
npx wrangler d1 execute horas-complementares --remote \
  --command "UPDATE usuarios SET pode_convidar = 1 WHERE email = 'colega@exemplo.br'"
```

Um professor nunca enxerga as turmas, os alunos nem os convites de outro.

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

- **Alunos**: um cartão por aluno com horas validadas, lançadas, a meta da turma dele e quantos
  registros esperam validação.
- **Validar** (com a contagem de pendentes ao lado): fila de atividades, com busca por aluno,
  atividade, local ou trecho da análise.
- **Turmas**: criar, renomear, ajustar a meta, ver o código e excluir turmas (uma turma com alunos
  não é excluída por engano).
- **Convites** (só para quem pode convidar): gerar, copiar e revogar convites de professor.
- **Meus dados**: nome e instituição, que aparecem para os alunos.

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
