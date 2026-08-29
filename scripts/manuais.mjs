// Gera os dois manuais em PDF — um para o professor, um para o aluno.
//
//   npm run manuais
//
// O texto mora aqui; as imagens são recortes de tela de verdade, guardados em
// docs/imagens-manual/. Regerar depois de mexer na tela mantém o manual honesto.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = process.cwd();
const SAIDA = path.join(RAIZ, 'docs');
const IMAGENS = path.join(SAIDA, 'imagens-manual');

// O endereço entra numa caixa na primeira página: sem ele, o manual manda a
// pessoa "abrir o endereço que passaram" e ela não tem onde clicar.
//   npm run manuais -- --endereco=https://postai.suafaculdade.br
const argumento = process.argv.slice(2).find((a) => a.startsWith('--endereco='));
const ENDERECO = (argumento ? argumento.slice(11) : process.env.ENDERECO
  || 'https://horas-complementares.jvctrfelix.workers.dev').replace(/\/$/, '');

const CORES = {
  aulas: '#2f6b52',
  horas: '#9a6212',
  alunos: '#1f5f78',
  turmas: '#574a97',
};

const professor = {
  arquivo: 'manual-professor.pdf',
  titulo: 'PostAí',
  subtitulo: 'Guia rápido do professor',
  cor: CORES.aulas,
  endereco: ENDERECO,
  abertura:
    'Este guia tem tudo o que você precisa para usar o sistema. São seis passos, e você não '
    + 'precisa saber nada de computador além de clicar e escrever. Qualquer coisa que der errado '
    + 'tem conserto: nada aqui apaga sozinho.',
  passos: [
    {
      titulo: 'Entrar no sistema',
      texto: [
        'Abra o endereço da caixa acima no navegador (Safari, Chrome, o que você já usa). '
        + 'Funciona igual no computador e no celular.',
        'Na primeira vez, toque em "Criar conta", escolha "Sou professor(a)" e informe o código '
        + 'de convite que a coordenação te passou. Depois disso é só e-mail e senha.',
      ],
      dica: 'Guarde o endereço nos favoritos do navegador. É sempre o mesmo.',
    },
    {
      titulo: 'A tela inicial: quatro botões',
      texto: [
        'Ao entrar, o sistema pergunta o que você quer fazer e mostra quatro botões grandes. '
        + 'Cada um tem uma cor e uma frase dizendo para que serve.',
        'Quando alguma coisa estiver esperando por você, aparece um aviso dentro do próprio '
        + 'botão — por exemplo "2 entregas para corrigir".',
      ],
      imagem: 'prof-menu.png',
      dica: 'Abriu um botão e quer voltar? Use o "‹ Voltar ao início", no alto da tela.',
    },
    {
      titulo: 'Criar a turma e passar o código',
      texto: [
        'Em "Turmas e matérias", crie a turma com o nome, o período e a sua matéria dentro dela.',
        'A turma ganha um código de 6 letras. É esse código que os alunos usam para entrar. '
        + 'O botão "Copiar convite" copia o texto pronto para colar no grupo da turma.',
        'Outro professor dá aula para os mesmos alunos? Ele usa o mesmo código para abrir a '
        + 'matéria dele na sua sala. Cada um cuida da sua matéria.',
      ],
      imagem: 'prof-turma.png',
      dica: 'Marque "Gera horas complementares" só nas matérias de estágio, extensão ou monitoria.',
    },
    {
      titulo: 'Publicar uma aula',
      texto: [
        'Em "Aulas e tarefas", toque em "+ Publicar uma aula". Escreva o título, escolha em quais '
        + 'matérias ela entra e, se quiser, anexe o slide ou o PDF.',
        'Depois de publicada, cada aula tem dois links: "Adicionar material" (outro arquivo ou um '
        + 'link) e "Criar tarefa".',
        'Na tarefa você escreve o enunciado, o prazo e quanto ela vale: nota, nas matérias comuns; '
        + 'horas, nas de estágio.',
      ],
      imagem: 'prof-publicar.png',
      dica: 'Quer preparar sem mostrar ainda? Escolha "Guardar como rascunho" — o aluno não vê.',
    },
    {
      titulo: 'Corrigir o que os alunos entregaram',
      texto: [
        'Na tarefa aparece "1 a avaliar". Toque em "Ver entregas" para ler o que cada aluno mandou.',
        'O documento aparece ali mesmo: "Ver aqui mesmo" abre o PDF na própria página, e "Baixar" '
        + 'salva no seu computador.',
        'Escreva a nota (ou as horas) e uma observação, e escolha "Aceitar" ou "Devolver". '
        + 'Devolver pede o motivo — é ele que o aluno lê para saber o que refazer.',
      ],
      imagem: 'prof-corrigir.png',
      dica: 'Na matéria de estágio, aceitar a entrega já lança as horas do aluno. Você não digita duas vezes.',
    },
    {
      titulo: 'Validar as horas complementares',
      texto: [
        'Em "Horas complementares" ficam as horas que os alunos lançaram por conta própria: '
        + 'congressos, cursos, monitoria, visitas.',
        'Cada uma traz a ficha completa, o texto do aluno e o comprovante. Você confere e escolhe: '
        + 'Aprovar (pode aprovar menos horas do que ele pediu), Devolver para correção, ou Reprovar.',
        'Devolveu? O aluno corrige, informa quanto tempo levou nisso e reenvia — esse tempo entra '
        + 'na conta das horas dele.',
      ],
      imagem: 'prof-validar.png',
      dica: 'O botão "Baixar planilha" leva tudo para o Excel, com as horas aprovadas e o status.',
    },
  ],
  perguntas: [
    ['Preciso instalar alguma coisa?',
      'Não. É um site. Abre no navegador do computador e no celular, do mesmo jeito.'],
    ['O aluno não aparece na minha lista.',
      'Ele ainda não entrou com o código da turma. Mande o código de novo pelo grupo.'],
    ['Recebo e-mail quando o aluno manda alguma coisa?',
      'Sim, com o trabalho no corpo da mensagem e o arquivo anexado. Em Configurações, na aba Meus dados, '
      + 'você liga e desliga esse aviso, e a própria tela diz se o envio está ligado no sistema.'],
    ['Errei ao aprovar. Dá para mudar?',
      'Dá. Abra a atividade e escolha outra opção. Cada passo fica registrado em '
      + '"Ver histórico da solicitação" — nada é apagado.'],
    ['Posso escrever coisas sobre um aluno?',
      'Sim. Em "Meus alunos", cada um tem um caderno de anotações que só a equipe vê. O aluno nunca vê.'],
    ['Esqueci a senha.',
      'Peça a quem administra o sistema para cadastrar uma nova para você.'],
  ],
  fecho:
    'Pronto. Publicar aula, corrigir entrega e validar hora — o resto é detalhe que você descobre '
    + 'clicando. Nenhum botão deste sistema apaga coisa de aluno sem perguntar antes.',
};

const aluno = {
  arquivo: 'manual-aluno.pdf',
  titulo: 'PostAí',
  subtitulo: 'Guia rápido do aluno',
  cor: CORES.alunos,
  endereco: ENDERECO,
  abertura:
    'Aqui ficam as aulas, os materiais e as tarefas da sua turma — e também as suas horas '
    + 'complementares. Tudo pelo celular, sem instalar nada.',
  passos: [
    {
      titulo: 'Criar a sua conta',
      texto: [
        'Abra o endereço da caixa acima e toque em "Criar conta". Escolha "Sou aluno(a)".',
        'Preencha nome, e-mail, senha e matrícula. Só isso já cria a sua conta.',
        'Se o professor já passou o código de 6 letras da turma, digite ali também — a tela mostra '
        + 'na hora em qual turma você entra e quem são os professores. Ainda não tem o código? '
        + 'Crie a conta assim mesmo: na primeira tela vai aparecer "Entre na sua turma", e você '
        + 'digita o código quando ele passar.',
      ],
      imagem: 'aluno-cadastro.png',
      dica: 'Errou de turma? Dá para corrigir depois na engrenagem (o desenho de roda dentada, no alto da tela), em "Seus dados".',
    },
    {
      titulo: 'Ver as aulas e entregar as tarefas',
      texto: [
        'A tela começa pelo que falta entregar. Depois vêm as aulas, separadas por matéria, com o '
        + 'nome do professor de cada uma.',
        'Para entregar: escreva a resposta no campo, anexe o arquivo se precisar, e toque em '
        + '"Entregar". O professor recebe na hora.',
        'Enquanto ele não corrige, aparece "aguardando avaliação". Se ele devolver, aparece '
        + '"devolvida para correção" com o que precisa ser refeito.',
      ],
      imagem: 'aluno-entregar.png',
      dica: 'Pode reenviar quantas vezes precisar até o professor aceitar.',
    },
    {
      titulo: 'Lançar uma hora complementar',
      texto: [
        'Toque em "+ Lançar nova atividade". Isso é para o que você fez por conta própria: '
        + 'congresso, curso, monitoria, visita, projeto de extensão.',
        'Preencha o nome, o tipo, a carga horária e a data. Anexe o certificado em '
        + '"Comprovante em arquivo" e, se tiver um relatório, use a área "Sua análise / registro" '
        + '— ela aceita PDF, Word e imagem.',
        'Se foi o professor que pediu o trabalho, não use aqui: entregue pela tarefa dele, lá em '
        + 'cima em "Aulas e tarefas".',
      ],
      imagem: 'aluno-lancar.png',
      dica: 'Só os quatro primeiros campos são obrigatórios. O resto ajuda o professor a validar mais rápido.',
    },
    {
      titulo: 'A caixa de entrada das suas atividades',
      texto: [
        'Abaixo do seu progresso fica a caixa de entrada. Cada linha é uma conversa sobre uma '
        + 'atividade: o que você mandou e o que o professor respondeu.',
        'A bolinha verde marca o que ainda não foi lido, e o que precisa de você fica em cima da '
        + 'lista. Toque numa linha para abrir a conversa inteira.',
      ],
      imagem: 'aluno-caixa.png',
      dica: 'A conversa guarda tudo: o que você lançou, o que o professor pediu e o que foi aprovado.',
    },
    {
      titulo: 'Se o professor devolver para correção',
      texto: [
        'A atividade devolvida não é editada: você a reenvia. Abra a conversa e, no lugar do botão '
        + '"Editar", aparece "Reenviar para validação".',
        'Ali você corrige o que foi pedido e informa quantas horas levou fazendo essa correção. '
        + 'Esse tempo é somado às suas horas — refazer também conta.',
        'Depois de reenviar, a atividade volta para a fila e o professor recebe o aviso.',
      ],
      imagem: 'aluno-reenviar.png',
      dica: 'O que o professor pediu fica registrado na conversa, para você conferir se atendeu tudo.',
    },
    {
      titulo: 'Acompanhar o seu progresso',
      texto: [
        'Em "Meu progresso" você vê quanto já foi aprovado, quanto está em análise e quanto ainda '
        + 'falta para fechar a carga do curso.',
        'Mais abaixo, "Por categoria" mostra o teto de cada tipo de atividade — por exemplo, no '
        + 'máximo 20 h de leitura. Passou do teto, o excedente não conta.',
        '"Baixar minha planilha" gera um arquivo com todos os seus lançamentos, para você guardar '
        + 'ou entregar na secretaria.',
      ],
      imagem: 'aluno-progresso.png',
      dica: 'Tarefa aceita numa matéria de estágio vira hora validada sozinha — você não precisa lançar de novo.',
    },
  ],
  perguntas: [
    ['Preciso instalar aplicativo?', 'Não. É um site, abre no navegador do celular.'],
    ['Posso mandar foto do certificado?', 'Pode. JPG, PNG, PDF, Word — todos são aceitos.'],
    ['Editei uma atividade já aprovada. E agora?',
      'Ela volta para a fila do professor, e ele valida de novo. Isso é normal.'],
    ['Faço parte de duas turmas.',
      'Hoje a conta fica em uma turma por vez. Fale com o professor.'],
    ['Esqueci a senha.', 'Peça ao professor para gerar uma nova para você.'],
  ],
  fecho:
    'Resumindo: tarefa que o professor pediu, você entrega pela tarefa. Coisa que você fez por '
    + 'fora, você lança em "Nova atividade" com o comprovante. O resto o sistema faz sozinho.',
};

// ---------------------------------------------------------------- desenho

const py = `
import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Image, KeepTogether, Table, TableStyle, NextPageTemplate)
from PIL import Image as PilImage
import json

dados = json.loads(sys.argv[1])
IMAGENS = sys.argv[2]
SAIDA = sys.argv[3]

cor = HexColor(dados['cor'])
cinza = HexColor('#59665f')
fundo_dica = HexColor('#f1f5f3')

LARGURA, ALTURA = A4
MARGEM = 20 * mm
UTIL = LARGURA - 2 * MARGEM

titulo = ParagraphStyle('titulo', fontName='Helvetica-Bold', fontSize=30, leading=34,
                        textColor=white, spaceAfter=6)
subtitulo = ParagraphStyle('subtitulo', fontName='Helvetica', fontSize=15, leading=19,
                           textColor=white)
abertura = ParagraphStyle('abertura', fontName='Helvetica', fontSize=12.5, leading=19,
                          textColor=HexColor('#16211d'), spaceAfter=18)
passo_num = ParagraphStyle('passo_num', fontName='Helvetica-Bold', fontSize=17, leading=22,
                           textColor=cor, spaceBefore=14, spaceAfter=8)
corpo = ParagraphStyle('corpo', fontName='Helvetica', fontSize=12, leading=18,
                       textColor=HexColor('#16211d'), spaceAfter=9, alignment=TA_LEFT)
dica_estilo = ParagraphStyle('dica', fontName='Helvetica-Oblique', fontSize=11, leading=16,
                             textColor=HexColor('#245542'))
pergunta = ParagraphStyle('pergunta', fontName='Helvetica-Bold', fontSize=12, leading=17,
                          textColor=HexColor('#16211d'), spaceBefore=10)
resposta = ParagraphStyle('resposta', fontName='Helvetica', fontSize=12, leading=17,
                          textColor=cinza)
secao = ParagraphStyle('secao', fontName='Helvetica-Bold', fontSize=17, leading=22,
                       textColor=cor, spaceBefore=18, spaceAfter=6)
rodape = ParagraphStyle('rodape', fontName='Helvetica', fontSize=9, textColor=cinza)


def capa(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(cor)
    canvas.rect(0, ALTURA - 62 * mm, LARGURA, 62 * mm, stroke=0, fill=1)
    # O título vai desenhado na faixa: o quadro de texto começa abaixo dela.
    canvas.setFillColor(white)
    canvas.setFont('Helvetica-Bold', 30)
    canvas.drawString(MARGEM, ALTURA - 36 * mm, dados['titulo'])
    canvas.setFont('Helvetica', 15)
    canvas.drawString(MARGEM, ALTURA - 46 * mm, dados['subtitulo'])
    canvas.restoreState()
    numero(canvas, doc)


def numero(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 9)
    canvas.setFillColor(cinza)
    canvas.drawRightString(LARGURA - MARGEM, 12 * mm, str(canvas.getPageNumber()))
    canvas.drawString(MARGEM, 12 * mm, dados['titulo'] + ' — ' + dados['subtitulo'])
    canvas.setStrokeColor(HexColor('#dde4e1'))
    canvas.line(MARGEM, 16 * mm, LARGURA - MARGEM, 16 * mm)
    canvas.restoreState()


def figura(nome, largura_max=UTIL, altura_max=95 * mm):
    if not nome:
        return None
    caminho = os.path.join(IMAGENS, nome)
    if not os.path.isfile(caminho):
        return None
    with PilImage.open(caminho) as im:
        l, a = im.size
    escala = min(largura_max / l, altura_max / a)
    img = Image(caminho, width=l * escala, height=a * escala)
    img.hAlign = 'LEFT'
    return img


def caixa_dica(texto):
    tabela = Table([[Paragraph('<b>Dica:</b> ' + texto, dica_estilo)]], colWidths=[UTIL])
    tabela.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), fundo_dica),
        ('LINEBEFORE', (0, 0), (0, -1), 3, cor),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    return tabela


doc = BaseDocTemplate(os.path.join(SAIDA, dados['arquivo']), pagesize=A4,
                      leftMargin=MARGEM, rightMargin=MARGEM,
                      topMargin=MARGEM, bottomMargin=24 * mm,
                      title=dados['titulo'] + ' — ' + dados['subtitulo'],
                      author='PostAí')

quadro_capa = Frame(MARGEM, 24 * mm, UTIL, ALTURA - 62 * mm - 34 * mm, id='capa')
quadro = Frame(MARGEM, 24 * mm, UTIL, ALTURA - MARGEM - 34 * mm, id='normal')
doc.addPageTemplates([
    PageTemplate(id='capa', frames=[quadro_capa], onPage=capa),
    PageTemplate(id='normal', frames=[quadro], onPage=numero),
])

# A faixa colorida com o título é só da primeira página.
historia = [NextPageTemplate('normal'), Spacer(1, 6 * mm), Paragraph(dados['abertura'], abertura)]

if dados.get('endereco'):
    endereco_rotulo = ParagraphStyle('endereco_rotulo', fontName='Helvetica-Bold', fontSize=11,
                                     leading=15, textColor=cinza)
    endereco_valor = ParagraphStyle('endereco_valor', fontName='Helvetica-Bold', fontSize=15,
                                    leading=20, textColor=cor)
    caixa = Table([[Paragraph('O ENDEREÇO DO SISTEMA', endereco_rotulo)],
                   [Paragraph(dados['endereco'], endereco_valor)],
                   [Paragraph('Abra no navegador do celular ou do computador e guarde nos favoritos.',
                              dica_estilo)]],
                  colWidths=[UTIL])
    caixa.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), fundo_dica),
        ('BOX', (0, 0), (-1, -1), 1.2, cor),
        ('LEFTPADDING', (0, 0), (-1, -1), 16),
        ('RIGHTPADDING', (0, 0), (-1, -1), 16),
        ('TOPPADDING', (0, 0), (0, 0), 14),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 14),
    ]))
    historia += [caixa, Spacer(1, 8 * mm)]

for i, passo in enumerate(dados['passos'], start=1):
    bloco = [Paragraph(str(i) + '. ' + passo['titulo'], passo_num)]
    for p in passo['texto']:
        bloco.append(Paragraph(p, corpo))
    if passo.get('dica'):
        bloco.append(caixa_dica(passo['dica']))
    # A imagem não se separa do passo que ela explica.
    img = figura(passo.get('imagem', ''))
    if img is not None:
        bloco.append(Spacer(1, 5 * mm))
        bloco.append(img)
    bloco.append(Spacer(1, 4 * mm))
    historia.append(KeepTogether(bloco))

historia.append(Paragraph('Perguntas que sempre aparecem', secao))
for q, r in dados['perguntas']:
    historia.append(KeepTogether([Paragraph(q, pergunta), Paragraph(r, resposta)]))

historia.append(Spacer(1, 8 * mm))
historia.append(caixa_dica(dados['fecho']))

doc.build(historia)
print(os.path.join(SAIDA, dados['arquivo']))
`;

fs.mkdirSync(SAIDA, { recursive: true });
if (!fs.existsSync(IMAGENS)) {
  console.error(`Faltam as imagens em ${IMAGENS} — veja o README (npm run manuais).`);
  process.exit(1);
}

const script = path.join(SAIDA, '.manuais.py');
fs.writeFileSync(script, py);
for (const manual of [professor, aluno]) {
  const saida = execFileSync('python3', [script, JSON.stringify(manual), IMAGENS, SAIDA], {
    encoding: 'utf8',
  });
  console.log('  ✓', path.relative(RAIZ, saida.trim()));
}
fs.rmSync(script);
