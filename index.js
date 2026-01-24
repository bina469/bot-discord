require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const http = require('http');

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= PAINEL ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;

/* ================= RELATÓRIO ================= */

let mensagemRelatorioId = null;
const logsRelatorio = [];

/* ================= TICKETS ================= */

const ticketsAbertos = new Map();

/* ================= HELPERS ================= */

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function responderTemp(interaction, texto, tempo = 5000) {
  let msg;

  if (interaction.replied || interaction.deferred) {
    msg = await interaction.followUp({
      content: texto,
      ephemeral: true
    });
  } else {
    msg = await interaction.reply({
      content: texto,
      ephemeral: true
    });
  }

  setTimeout(() => {
    msg.delete().catch(() => {});
  }, tempo);
}

/* ================= RELATÓRIO ================= */

async function enviarRelatorio(acao, detalhes) {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  logsRelatorio.push(`[${horarioBrasilia()}] ${acao} — ${detalhes}`);

  const texto = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.join('\n')}`;

  if (mensagemRelatorioId) {
    try {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      return msg.edit({ content: texto });
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send(texto);
  mensagemRelatorioId = msg.id;
}

/* ================= PAINEL ================= */

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoes = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];

  for (let i = 0; i < botoes.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Secondary)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');

  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);

  await canalTicket.send({
    content: '🎫 **ATENDIMENTO**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Abrir Ticket')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ===== CONECTAR ===== */

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return responderTemp(interaction, '⚠️ Telefone ocupado.');

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      const atual = atendimentosAtivos.get(interaction.user.id) || [];
      atual.push(tel);
      atendimentosAtivos.set(interaction.user.id, atual);

      await atualizarPainel();
      await enviarRelatorio('📞 Conectou', `${interaction.user.username} → ${tel}`);

      return responderTemp(interaction, `📞 Conectado ao **${tel}**`);
    }

    /* ===== SAIR TODOS ===== */

    if (interaction.isButton() && interaction.customId === 'sair_todos') {

      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      for (const tel of lista) delete estadoTelefones[tel];

      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();

      await enviarRelatorio('🔴 Saiu todos', interaction.user.username);

      return responderTemp(interaction, '🔴 Desconectado de todos.');
    }

    /* ===== MENU SAIR ===== */

    if (interaction.isButton() && interaction.customId === 'menu_sair') {

      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      if (!lista.length)
        return responderTemp(interaction, '⚠️ Você não está em nenhum telefone.');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {

      const tel = interaction.values[0];

      delete estadoTelefones[tel];

      atendimentosAtivos.set(
        interaction.user.id,
        (atendimentosAtivos.get(interaction.user.id) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      await enviarRelatorio('📴 Saiu', `${interaction.user.username} → ${tel}`);

      await interaction.update({ content: '📴 Desconectado.', components: [] });

      return;
    }

    /* ===== TRANSFERIR ===== */

    if (interaction.isButton() && interaction.customId === 'menu_transferir') {

      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      if (!lista.length)
        return responderTemp(interaction, '⚠️ Você não está conectado.');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {

      telefoneSelecionado.set(interaction.user.id, interaction.values[0]);

      await interaction.update({
        content: '👤 Escolha o usuário:',
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('transferir_user')
          )
        ]
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {

      const tel = telefoneSelecionado.get(interaction.user.id);
      const novoId = interaction.values[0];

      const novo = await interaction.guild.members.fetch(novoId);

      const antigo = estadoTelefones[tel];

      estadoTelefones[tel] = {
        userId: novoId,
        nome: novo.user.username
      };

      atendimentosAtivos.set(
        novoId,
        [...(atendimentosAtivos.get(novoId) || []), tel]
      );

      atendimentosAtivos.set(
        interaction.user.id,
        (atendimentosAtivos.get(interaction.user.id) || []).filter(t => t !== tel)
      );

      telefoneSelecionado.delete(interaction.user.id);

      await atualizarPainel();
      await enviarRelatorio('🔁 Transferiu', `${antigo.nome} → ${tel} → ${novo.user.username}`);

      await interaction.update({ content: '🔁 Transferência concluída.', components: [] });
    }

    /* ===== FORÇAR ===== */

    if (interaction.isButton() && interaction.customId === 'menu_forcar') {

      const ocupados = Object.entries(estadoTelefones);

      if (!ocupados.length)
        return responderTemp(interaction, '⚠️ Nenhum telefone ocupado.');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_tel')
        .setPlaceholder('Telefone')
        .addOptions(ocupados.map(([t]) => ({ label: t, value: t })));

      return interaction.reply({
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {

      const tel = interaction.values[0];
      const dono = estadoTelefones[tel];

      atendimentosAtivos.set(
        dono.userId,
        (atendimentosAtivos.get(dono.userId) || []).filter(t => t !== tel)
      );

      delete estadoTelefones[tel];

      await atualizarPainel();
      await enviarRelatorio('⚠️ Forçado', `${dono.nome} removido de ${tel}`);

      await interaction.update({ content: '⚠️ Desconectado.', components: [] });
    }

  } catch (err) {
    console.error('❌ ERRO INTERAÇÃO:', err);
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);

http.createServer((_, res) => {
  res.end('OK');
}).listen(PORT);
