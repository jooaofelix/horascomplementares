# Integração — enviar horas de outro sistema

Um sistema externo (portal de exercícios, controle de eventos, monitoria) envia as atividades já
apuradas para cá. Elas caem na fila do professor como qualquer outra — ou já validadas, se a origem
for confiável.

## 1. Gerar a chave

O professor abre a aba **Integração** e gera uma chave com o nome do sistema de origem. A chave
aparece **uma única vez**, no formato:

```
hc_A7K2PQ4M_9XJ4LT2WQFB6NRVD8HKC3YSZM5PGA7E2
```

Guarde-a como segredo (variável de ambiente). Perdeu, revogue e gere outra.

## 2. Enviar as atividades

```
POST https://horas-complementares.SEU-SUBDOMINIO.workers.dev/api/integracao/atividades
Authorization: Bearer hc_...
Content-Type: application/json
```

```json
{
  "turma_codigo": "6E56UK",
  "atividades": [
    {
      "origem_id": "exerc-2026-001",
      "aluno": { "email": "ana@ex.br", "matricula": "2026001", "nome": "Ana Ribeiro" },
      "titulo": "Exercício 3 — registro cursivo",
      "categoria": "Registro cursivo",
      "horas": 2,
      "data_atividade": "2026-04-10",
      "data_fim": null,
      "local": "Portal de Exercícios",
      "responsavel": "Correção automática",
      "comprovante": "https://portal.exemplo/entregas/001",
      "texto": "Transcrição da entrega do aluno.",
      "validado": true,
      "observacao": "Corrigido automaticamente."
    }
  ]
}
```

Campos obrigatórios por item: `titulo`, `categoria`, `horas`, `data_atividade` e um `aluno` com
`email` **ou** `matricula`. `categoria` precisa ser uma das categorias do sistema.

Limite de **200 atividades por chamada**.

## 3. Ler a resposta

```json
{
  "turma": { "id": 1, "nome": "Técnicas de Observação — 4º período" },
  "recebidas": 3, "criadas": 2, "atualizadas": 1, "erros": 0, "alunos_criados": 1,
  "resultados": [
    { "indice": 0, "origem_id": "exerc-2026-001", "status": "criada", "atividade_id": 12, "aluno_criado": true },
    { "indice": 1, "origem_id": "exerc-2026-002", "status": "atualizada", "atividade_id": 9 },
    { "indice": 2, "origem_id": "exerc-2026-003", "status": "erro", "motivo": "As horas devem ser um número maior que zero." }
  ]
}
```

Um item inválido **não** derruba o lote: o resto entra e o erro volta na linha dele.

## Regras que valem a pena conhecer

**Idempotência.** `origem_id` é a identidade do lançamento no sistema de origem. Reenviar o mesmo
`origem_id` **atualiza** a atividade em vez de criar outra — reprocessar um lote é seguro.

**Aluno que ainda não tem conta.** Se o e-mail não existe, o aluno é criado *pré-cadastrado*: entra
na turma e recebe as horas, mas sem senha. Quando a pessoa se cadastrar com o mesmo e-mail, ela
assume a conta e encontra o histórico já lá. Antes disso, o login avisa que a conta veio da
importação.

**Escopo da chave.** A chave só enxerga as turmas do professor que a gerou. Turma de outro
professor responde `404`.

**Sem `origem_id`.** Funciona, mas cada envio cria um registro novo. Use apenas para carga única.

## Erros

| Código | Quando |
| --- | --- |
| `401` | chave ausente, malformada, revogada ou inválida |
| `404` | `turma_codigo` não é de uma turma desta chave |
| `400` | corpo sem `turma_codigo` ou sem `atividades` |
| `413` | mais de 200 atividades na mesma chamada |

## Exemplo com curl

```bash
curl -X POST https://horas-complementares.SEU-SUBDOMINIO.workers.dev/api/integracao/atividades \
  -H "Authorization: Bearer $CHAVE_HORAS" \
  -H "Content-Type: application/json" \
  -d '{"turma_codigo":"6E56UK","atividades":[{"origem_id":"exerc-1","aluno":{"email":"ana@ex.br"},"titulo":"Exercício 1","categoria":"Outro","horas":2,"data_atividade":"2026-04-10"}]}'
```
