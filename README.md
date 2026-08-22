# Horas Complementares — Psicologia / Técnicas de Observação

Sistema web para a turma registrar horas complementares junto com a **análise escrita** de cada
atividade: o aluno digita direto no navegador ou solta um arquivo `.txt` / `.md` no formulário, e o
texto fica guardado junto com as horas. O professor acompanha o total de cada aluno e coloca o selo
de validação nos registros que conferiu.

Roda com **zero dependências** — só o Node.js e o SQLite que já vem embutido nele.

## Como rodar

```bash
git clone <url-do-repositorio>
cd horascomplementares
npm start
```

Abra <http://localhost:3000>. O banco é criado sozinho em `data/horas.db`.

Requer **Node.js 22.5 ou mais novo** (usa o módulo `node:sqlite`). Confira com `node -v`.

Para mudar a porta: `PORT=8080 npm start`.

## Contas

- **Aluno**: cria a conta sozinho na tela de cadastro (nome, e-mail e senha).
- **Professor**: cria a conta na mesma tela, preenchendo o campo **código de professor**.

O código padrão é `tecnicas-de-observacao`. Troque antes de usar com a turma:

```bash
CODIGO_PROFESSOR="algum-codigo-so-seu" npm start
```

Pode haver mais de um professor — todos enxergam a turma inteira.

## Como o aluno usa

1. Preenche título, categoria, data e quantas horas a atividade rendeu.
2. Escreve a análise no campo de texto **ou** arrasta um arquivo `.txt`/`.md` para a área pontilhada
   (o conteúdo entra no campo e ainda dá para editar antes de salvar; o nome do arquivo fica
   registrado junto).
3. Salva. As horas entram na hora no total **declarado**.

Categorias disponíveis: Observação em campo, Registro cursivo, Análise de material,
Leitura / fichamento, Supervisão, Seminário / evento, Outro.

## Como funciona a validação

Toda hora declarada já conta no painel do aluno. O professor, na aba **Registros**, lê a análise e
marca *Validar horas* — com uma observação opcional que aparece para o aluno. O painel mostra os dois
totais lado a lado: **declarado** e **validado**.

Se o aluno editar uma atividade já validada, o selo cai e ela volta para a fila de pendentes — assim
o professor sempre valida a versão que está lá.

## O que o professor vê

- **Turma**: um panorama com horas validadas, declaradas e quantos registros faltam conferir por aluno.
- **Registros**: todas as atividades da turma, com busca por aluno/título/trecho da análise e filtro
  por status (começa mostrando só as pendentes).
- **Ajustes**: meta de horas da turma e nome que aparece no topo.

O botão **Exportar CSV** baixa uma planilha — o aluno leva só os próprios registros, o professor leva
os da turma inteira (abre direto no Excel ou no Google Planilhas).

## Estrutura

```
server.js          servidor HTTP, arquivos estáticos e roteamento
src/db.js          esquema do SQLite e categorias
src/auth.js        senhas (scrypt), sessões por cookie
src/api.js         rotas da API e regras de validação
public/            interface (HTML, CSS e JavaScript sem framework)
test/api.test.js   testes de ponta a ponta da API
data/horas.db      banco de dados (criado ao rodar; fora do Git)
```

## Testes

```bash
npm test
```

Sobe o servidor com um banco em memória e cobre cadastro, login, registro de horas, validação,
permissões entre alunos, exportação e os erros de formulário.

## Backup

Tudo mora em `data/horas.db`. Para guardar uma cópia, pare o servidor e copie a pasta `data/`
inteira — ou use o CSV exportado como cópia de segurança em formato aberto.

## Colocando no ar para a turma

O jeito mais simples é rodar em um computador da faculdade ou num servidor barato e acessar pela rede
local. Se for expor na internet, coloque atrás de um proxy com HTTPS (Caddy, nginx) — os cookies de
sessão vão sem a flag `Secure` justamente para funcionar em `http://localhost`.
