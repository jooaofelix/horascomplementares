-- O professor pode receber os avisos num endereço diferente daquele com que
-- entra no sistema — o pessoal costuma ter um e-mail de trabalho e outro que
-- olha no celular. Vazio: vale o e-mail da conta.
-- Rodar: npm run banco:migrar

ALTER TABLE usuarios ADD COLUMN email_aviso TEXT;
