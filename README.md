# Sala de Aula

Sistema web da faculdade para o dia a dia da turma: o professor publica **aulas** com slides e
materiais, cria **tarefas** com prazo, e os alunos entregam pelo celular. O controle de **horas
complementares** é uma das partes — e a que fecha o ciclo, porque uma tarefa aceita vira hora
validada sem ninguém redigitar nada.

A ideia é a de um Google Classroom próprio da instituição, com a parte de horas complementares que
o Classroom não tem.

A **turma é a sala**: ela tem o código de acesso, e dentro dela ficam as **matérias**, uma por
professor. Assim o aluno entra uma vez e passa a ter todos os professores daquela turma, e cada
professor tem quantas matérias quiser, em quantas turmas quiser. Quem só entrou pelo código de uma
sala não enxerga as outras — dá para a faculdade inteira usar a mesma instalação.

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

Quando uma mudança precisar de colunas novas no banco:

```bash
npm run banco:migrar
```

Ele aplica só o que falta, na ordem, e pode ser rodado quantas vezes você quiser: quando um arquivo
já foi aplicado, ele é refeito comando a comando e os passos que já existem são pulados. É o mesmo
comando para um banco novo e para um que parou no meio.

O banco local não precisa disso: ao iniciar, o `npm start` confere e cria sozinho as colunas que
faltarem.

Um teste refaz esse caminho a cada `npm test`: parte do esquema do primeiro commit, aplica todas as
migrações em ordem e confere que o banco resultante tem tudo o que o código espera — inclusive
rodando as migrações duas vezes, para garantir que repetir não quebra.

Testar a versão Cloudflare na sua máquina antes de publicar:

```bash
npx wrangler d1 execute horas-complementares --local --file=src/esquema.sql   # uma vez
npx wrangler dev --local
```

> Os dois modos têm bancos separados: o que você cadastrar em `npm start` não aparece no site
> publicado, e vice-versa.

## Onde fica cada coisa

A tela do dia a dia tem só o que se usa toda semana:

| Quem | Vê |
| --- | --- |
| **Aluno** | as aulas e tarefas, separadas por matéria; abaixo, as próprias horas complementares |
| **Professor** | uma tela inicial com quatro botões grandes, e uma coisa de cada vez |

A tela do professor foi desenhada para quem usa o computador de vez em quando: ao entrar, ele vê
**"Olá, Helena. O que você quer fazer agora?"** e quatro botões do tamanho de um cartão, cada um com
um ícone, o nome e uma frase dizendo o que faz — *Aulas e tarefas*, *Horas complementares*, *Meus
alunos*, *Turmas e matérias*. Cada área tem a sua cor, e o que está esperando por ele aparece como
uma etiqueta no botão ("2 entregas para corrigir"). Abrir um deles esconde o resto e mostra um
**‹ Voltar ao início** no topo — nunca há duas telas disputando a atenção, nem abas pequenas para
acertar com o dedo. Quem não tem matéria que gere horas nem vê o botão de horas.

O resto — cursos e categorias, pessoas, convites, integração e os próprios dados — fica atrás da
**engrenagem** no canto superior, numa tela de configurações com suas próprias abas. É configuração
de instalação, não trabalho de aula.

## Ver funcionando, com uma faculdade de mentira dentro

```bash
npm run demo
```

Monta do zero uma faculdade de exemplo — duas professoras dividindo a mesma turma, seis alunos,
aulas com PDF, tarefas entregues, notas dadas, horas esperando validação, anotações — e abre o
sistema já com ela dentro, em <http://localhost:3000>. O terminal imprime os logins (a senha de
todo mundo é `demo1234`) e os códigos das salas.

O banco da demonstração é um arquivo à parte (`data/demo.db`), refeito a cada vez: nada disso
encosta no banco de verdade, e rodar de novo devolve tudo ao estado inicial.

Para mostrar a alguém pelo link, a mesma demonstração pode ser montada **no sistema publicado**:

```bash
npm run demo -- --em https://horas-complementares.SEU-USUARIO.workers.dev
```

Só funciona numa instalação ainda vazia — se já houver conta de professor lá, o comando recusa,
porque os dados são fictícios e ele não saberia separá-los dos de verdade. Para limpar depois:

```bash
npm run banco:backup   # se houver algo de verdade lá dentro
npx wrangler d1 execute horas-complementares --remote --file=scripts/limpar.sql
```

## Manuais em PDF

Dois guias prontos para imprimir ou mandar por e-mail, com imagens das telas de verdade:

- **`docs/manual-professor.pdf`** — entrar, criar a turma e passar o código, publicar aula, corrigir
  entregas, validar horas, e as perguntas que sempre aparecem;
- **`docs/manual-aluno.pdf`** — criar a conta com o código, entregar tarefa, lançar hora
  complementar com comprovante, reenviar depois de uma correção, acompanhar o progresso.

Mudou a tela? `npm run manuais` refaz os dois a partir de `docs/imagens-manual/` — as imagens são
recortes capturados do sistema rodando, então o manual não descreve uma tela que não existe mais.
(Precisa de `pip install reportlab pillow`.)

## Papéis

| Papel | Enxerga | Faz |
| --- | --- | --- |
| **Aluno** | só os próprios registros | lança atividades e acompanha as horas |
| **Professor** | as turmas onde tem matéria | valida as horas dos alunos dessas turmas |
| **Coordenador** | todas as turmas dos cursos que coordena | valida em qualquer turma do curso |
| **Admin** | a faculdade inteira | cursos, categorias, limites, papéis e pessoas |

A **primeira conta de equipe** criada numa instalação nova entra sem convite e já como
administradora. Daí em diante, conta de professor só com convite de uso único; o admin promove a
coordenador ligando a pessoa a um curso.

## Cursos, categorias e limites

O **curso** define a carga obrigatória do aluno (ex.: Psicologia, 100 h) — é ela que vira a meta de
quem está no curso. As **categorias** de atividade são cadastráveis, e cada curso define o **teto**
de cada categoria, em horas ou em percentual do total:

| Categoria | Limite no curso |
| --- | --- |
| Observação em campo | 40 h |
| Leitura / fichamento | 20% de 100 h = 20 h |

O aluno vê esse quadro no próprio painel, com quanto já tem em cada categoria e quanto ainda cabe.
Categoria sem regra no curso não tem teto. Categoria já usada em atividades não é apagada: ela é
desativada e some das listas novas, preservando o histórico.

O aluno herda o curso da turma em que entrou pelo código — não precisa escolher nada.

## Turmas e matérias

A turma é o grupo de alunos — "4º período — Psicologia, 2026.1 manhã" — e é dela o código de acesso.
Dentro dela cada professor cria a **matéria** que dá: Técnicas de Observação, Estágio Supervisionado,
Seminário de Pesquisa. Disso sai o resto:

- **o aluno tem vários professores**: entra uma vez, com um código só, e o mural dele vem separado
  por matéria, com o nome de quem dá cada uma;
- **o professor tem várias matérias**, na mesma turma ou em turmas diferentes, e navega entre elas
  pelo seletor **Matéria que você está vendo**;
- **quem chegou depois entra pelo mesmo código**: em *Turmas → Entrar numa turma que já existe*, o
  colega informa o código da sala e cria a matéria dele ali. Ele passa a ver os alunos da turma e a
  validar as horas deles, mas mexe só na própria matéria — a turma em si continua com quem a criou.

## Tarefa que vale nota, tarefa que vale hora

Como a matéria decide se gera hora complementar, a tarefa dela é avaliada do jeito certo sem o
professor precisar configurar nada:

| Matéria | O que a tarefa pede | O que o professor lança ao aceitar |
| --- | --- | --- |
| Estágio, extensão, monitoria | **quantas horas vale** e a categoria | as horas, que viram atividade já validada |
| Disciplina comum | **a nota máxima** (ex.: até 10) | a nota, que aparece para o aluno na hora |

O aluno vê "vale nota até 10" antes de entregar e "Corrigida: nota 9 de 10" depois, junto com a
observação do professor. Nota não vira hora complementar — são coisas diferentes, e o histórico de
horas do aluno continua limpo.

## Matéria que gera horas, matéria que não gera

Nem toda matéria vira hora complementar. Ao criá-la, o professor marca **"esta matéria gera horas
complementares"** — para estágio, extensão, monitoria. Uma disciplina comum fica desmarcada, e então:

- o aluno **só vê** a seção de horas se alguma matéria da sala dele gerar horas; se nenhuma gera, a
  tela dele é só aulas e tarefas;
- no painel do professor, o cartão do aluno mostra "sala sem matéria que gere horas" no lugar dos
  totais;
- a mesma turma pode ter as duas coisas ao mesmo tempo — Técnicas de Observação sem horas, Estágio
  Supervisionado com 300 h de meta.

Marcar depois funciona: a matéria passa a contar sem precisar recriar nada.

## Aviso por e-mail a cada envio

Todo envio de aluno chega no e-mail de quem vai avaliar — **com a atividade inteira no corpo da
mensagem e o arquivo anexado**, para o professor ler sem precisar abrir o sistema:

| O que o aluno fez | Quem recebe | O que vai no e-mail |
| --- | --- | --- |
| Lançou hora complementar | professor das matérias que geram horas na sala dele (senão, quem criou a sala) | ficha completa da atividade, a análise e os arquivos |
| Entregou (ou refez) uma tarefa | professor de cada matéria que a tarefa alcança | a resposta escrita, o tempo de revisão e o arquivo |

Cada professor liga e desliga isso em **Configurações → Meus dados**. O envio nunca atrasa nem
derruba a ação do aluno: falha do serviço de e-mail vira linha no log, e no Cloudflare a mensagem
sai depois da resposta (`waitUntil`).

### Ligar o envio

Sem configuração, o sistema funciona por inteiro e só não avisa. Para ligar, use qualquer serviço com
API HTTP (o padrão é o [Resend](https://resend.com), plano gratuito suficiente para uma faculdade):

```bash
# no seu computador (.env, ou na frente do comando)
EMAIL_CHAVE=re_xxx EMAIL_DE="Sala de Aula <avisos@seu-dominio.br>" npm start

# no Cloudflare
npx wrangler secret put EMAIL_CHAVE
npx wrangler secret put EMAIL_DE
```

`EMAIL_URL` troca o serviço (qualquer um que aceite `{from, to, subject, text, attachments}`), e
`EMAIL_RESPONDER_PARA` define o endereço de resposta.

## Quando o professor pede correção

**Na hora complementar**, devolver para correção fecha a edição: o cartão do aluno troca o botão
*Editar* por um bloco **"Reenviar para validação"**, que pede três coisas — quantas horas ele levou
corrigindo (obrigatório), a análise corrigida e, se quiser, outro arquivo. Ao reenviar:

- as horas da correção **somam** à carga declarada (6 h + 1,5 h = 7,5 h) e ficam guardadas à parte,
  somando de novo a cada nova volta;
- a atividade volta para a fila como pendente, e o professor recebe o e-mail com o tempo informado,
  o total novo e os arquivos;
- o que ele tinha pedido continua no cartão, agora como *"O professor havia pedido"*, para ele
  conferir se foi atendido.

Editar uma atividade devolvida deixa de ser possível — a API responde 409 apontando o caminho certo.

## Quando o professor pede revisão de uma tarefa

Ao devolver uma entrega, o professor escreve o que falta. Do lado do aluno aparece um campo a mais:
**"quanto tempo levou para refazer"**. Esse tempo se soma à carga da tarefa — refazer dá trabalho, e
o trabalho conta:

- o aluno informa 1,5 h de revisão numa tarefa de 4 h;
- na fila de correção, o professor vê `4 h da tarefa + 1,5 h que o aluno levou refazendo` e o campo
  já vem com **5,5**;
- ele pode digitar outro número por cima antes de aceitar;
- devolveu de novo? o que o aluno informar soma ao que já havia.

## Anotações sobre o aluno

No cartão de cada aluno há um caderno privado da equipe: "faltou nos dois últimos encontros de campo,
combinamos reposição em 12/05". Cada anotação guarda quem escreveu e quando; cada um edita e apaga só
o que escreveu. **O aluno nunca vê** — nem pela API: a rota responde 403 para ele, e um teste confere
que nada disso vaza no que ele lê.

## Códigos de acesso

Na aba **Turmas**, o professor cria a turma com nome, período, **meta de horas própria** e a primeira
matéria — a dele. Cada turma ganha um código de 6 caracteres (ex.: `9PFQ3K`), sem letras ambíguas
para não confundir na hora de ditar em sala. O botão **Copiar convite** copia o endereço do sistema
junto com o código, pronto para colar no grupo da turma.

O mesmo código serve para as duas pontas: o **aluno** o usa ao criar a conta — antes de confirmar, a
tela lista a turma e todas as matérias com seus professores — e o **professor** o usa para abrir a
matéria dele naquela sala. Se o aluno errar de turma, ele mesmo corrige em *Seus dados* com o código
certo.

Com mais de uma matéria aparece o seletor **Matéria que você está vendo**, que filtra de uma vez o
mural, a lista de alunos, a fila de validação e a planilha exportada.

## Contas

- **Aluno**: escolhe *Sou aluno(a)* na tela de cadastro e informa o código da turma.
- **Professor**: escolhe *Sou professor(a)* e informa um **código de convite**.

O primeiro professor de uma instalação nova entra sem convite — não haveria quem o convidasse — e é
ele quem passa a poder convidar os outros. Na aba **Convites** ele gera códigos de uso único, cada um
com uma anotação para lembrar de quem é, copia o convite pronto para enviar e revoga os que ainda não
foram usados. A lista mostra quem usou cada convite e quando.

Quem entra por convite vira professor pleno das próprias matérias, mas não gera convites: a porta
continua sendo só sua. Para dar essa permissão a outra pessoa:

```bash
npx wrangler d1 execute horas-complementares --remote \
  --command "UPDATE usuarios SET pode_convidar = 1 WHERE email = 'colega@exemplo.br'"
```

Um professor nunca enxerga as matérias, os alunos nem os convites de quem não divide turma com ele.

## Aulas, materiais e tarefas

Além do lançamento avulso de horas, o professor tem um mural por matéria:

- **Aulas** com título, data e descrição — e rascunho, que o aluno não vê até ser publicado. Uma
  mesma aula pode ser publicada para **várias matérias de uma vez**: o professor de 3A e 3B monta o
  material uma vez só, e cada turma vê no mural dela.
- **Materiais** dentro de cada aula: arquivo ou link. A própria tela de publicar a aula já aceita o
  slide ou o PDF, sem precisar de um segundo passo.
- **Tarefas** com enunciado, prazo, categoria e quantas horas valem. Tarefa criada dentro de uma
  aula compartilhada alcança as mesmas matérias dela, e a fila de correção junta as entregas de
  todas, com o nome da turma ao lado de cada aluno.

O aluno abre a turma no celular, baixa o material e entrega ali mesmo — texto, arquivo, ou os dois.
O professor vê a fila (`3 a avaliar`), lê a entrega e decide:

- **Devolver**, com o motivo obrigatório — o aluno vê a observação e reenvia.
- **Aceitar**, informando quantas horas valem — e é aqui que os dois lados do sistema se encontram:
  a entrega aceita **vira automaticamente uma atividade já validada** no histórico do aluno, com a
  categoria da tarefa e o texto entregue. Ninguém redigita nada. Reavaliar com outra carga corrige a
  mesma atividade em vez de criar outra.

## Caixa de entrada do aluno

A lista de atividades do aluno é uma caixa de entrada: cada linha é uma conversa sobre um
lançamento — quem falou por último, o assunto, um pedaço da resposta, a data e o estado. O que
precisa dele fica em cima; o que o professor respondeu depois da última abertura vem em negrito,
com uma bolinha (a leitura fica guardada em `atividades.lida_em`, não no navegador).

Tocar numa linha abre a conversa: a trilha de auditoria vira balões — o que o aluno lançou, o que o
professor pediu, o reenvio, a aprovação — e abaixo dela ficam as ações possíveis naquele momento
(reenviar, editar, excluir) e os anexos.

## Os dois arquivos da hora complementar

Uma hora lançada pelo aluno costuma ter dois papéis, e o formulário separa os dois:

| Campo | O que é | Onde fica |
| --- | --- | --- |
| **Comprovante em arquivo** | o certificado, a declaração assinada, a foto do papel | logo abaixo do nº do certificado |
| **Sua análise / registro** | o relatório do próprio aluno, em PDF, Word ou digitado ali mesmo | na área com borda tracejada |

Na área da análise, arquivo `.txt` ou `.md` continua entrando **como texto** dentro do campo — dá para
revisar e editar antes de salvar. Qualquer outro formato (o caso comum: o relatório em PDF) fica
anexado à atividade, e o nome do arquivo já preenche o título quando ele está vazio.

Os dois ficam guardados com hash SHA-256, e aparecem no cartão da atividade com três opções para o
professor: **Baixar**, **Abrir em outra aba** e **Ver aqui mesmo** — que abre o PDF (ou a imagem)
dentro da própria página, sem sair da fila de validação. Vale igual para o arquivo que o aluno
entregou numa tarefa, na fila de correção. Formato que o navegador não abre (Word, planilha) mostra
só Baixar, dizendo isso. Quem abre: o aluno que lançou e a equipe que acompanha
a turma dele; professor de outra turma recebe 404, e há teste para isso. Editar a atividade sem
escolher outro arquivo mantém o que já estava anexado.

### Formatos aceitos

PDF · PPTX, PPT, ODP · DOCX, DOC, ODT · XLSX, XLS, CSV · JPG, PNG, WEBP, HEIC · TXT, MD

Vale tanto para o material da aula quanto para a entrega do aluno. Quando o navegador não informa o
tipo — comum no celular e com arquivos do Office — o sistema descobre pela extensão do nome.

### Onde os arquivos ficam

| Onde roda | Destino | Limite por arquivo |
| --- | --- | --- |
| Seu computador | `data/arquivos/` | 8 MB |
| Cloudflare **com** bucket R2 | R2 | 8 MB |
| Cloudflare **sem** R2 | o próprio D1, em partes | 6 MB |

Sem R2, o conteúdo é fatiado em pedaços de 600 KB — o D1 aceita cerca de 1 MB por valor, então um
slide de vários MB cabe assim mesmo. O banco tem 500 MB no plano gratuito, o que dá bastante aula;
quando apertar, o R2 resolve sem migrar nada, porque cada arquivo guarda em qual destino foi salvo.

Para usar o R2 é preciso ativá-lo uma vez em **dash.cloudflare.com → R2** (a Cloudflare pede um
cartão mesmo na faixa gratuita). Depois:

```bash
npx wrangler r2 bucket create horas-arquivos
```

e descomente o bloco `[[r2_buckets]]` no `wrangler.toml`. Todo arquivo guarda o **hash SHA-256** do
conteúdo, que é o que permitirá verificar mais adiante se o documento aprovado é exatamente aquele.

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

## Status e trilha de auditoria

Cada atividade percorre um fluxo, não um sim-ou-não:

| Status | O que significa |
| --- | --- |
| **aguardando análise** | o aluno lançou, ninguém abriu ainda |
| **em análise** | a coordenação assumiu a solicitação |
| **devolvida para correção** | falta algo — o motivo é obrigatório e aparece para o aluno |
| **aprovada** | virou hora válida, com a carga que a coordenação definiu |
| **reprovada** | não conta; o motivo é obrigatório |

A coordenação pode **aprovar com menos horas** do que o aluno declarou (nunca mais). O painel do
aluno mostra os dois números — "6 h das 10 h declaradas" — e o total considera sempre as aprovadas.
Editar uma atividade já analisada devolve ela para a fila.

Toda mudança grava uma linha na tabela `auditoria`: ação, descrição legível, quem fez, com qual
papel, de qual IP e quando. **Nada é editado ou apagado** — o histórico só cresce. Aluno e
coordenação abrem a trilha em "Ver histórico da solicitação":

```
26/08/2026 02:17 · Ana Ribeiro (aluno)
Atividade lançada pelo aluno: Congresso de Psicologia Escolar (10 h declaradas).

26/08/2026 02:17 · Profa. Marina Alves (admin)
Solicitação devolvida para correção. Motivo: Anexe o certificado com a carga horária.

26/08/2026 02:18 · Profa. Marina Alves (admin)
Solicitação aprovada com 6 h (o aluno havia declarado 10 h).
```

É essa trilha que sustenta o código de validação, o QR Code e a página pública de autenticidade.

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

## Onde os dados ficam, e como olhar

Tudo mora num banco SQL de verdade — SQLite, servido como **Cloudflare D1** em produção e como
arquivo local em desenvolvimento. São tabelas relacionadas com chave estrangeira e índice, não
arquivos soltos.

Ver quantos registros existem em cada tabela, direto do banco publicado:

```bash
npm run banco:ver
```

> O D1 recusa `UNION ALL` com muitos termos (`too many terms in compound SELECT`), por isso a
> consulta usa subconsultas numa linha só. Vale lembrar disso ao escrever relatórios: o SQLite local
> aceita coisas que o D1 recusa.

Consultar o que quiser, em SQL:

```bash
npx wrangler d1 execute horas-complementares --remote \
  --command "SELECT nome, email, papel FROM usuarios ORDER BY id"
```

Pelo navegador, sem terminal: **dash.cloudflare.com** → Storage & Databases → D1 →
`horas-complementares` → aba **Console**, que aceita SQL e mostra o resultado em tabela.

O banco local (`data/horas.db`) abre em qualquer visualizador de SQLite — DB Browser for SQLite,
TablePlus, ou a extensão SQLite do próprio VS Code.

## Backup

- **Local**: tudo mora em `data/horas.db`; pare o servidor e copie a pasta `data/`.
- **Publicado**: `npm run banco:backup` (gera `backup-horas.sql`, o banco inteiro em SQL).
- **Sempre**: o CSV exportado pela interface serve como cópia em formato aberto.
