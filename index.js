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

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();
let mensagemPainelId = null;

/* ================= TICKETS (intocado) ================= */
const ticketsAbertos = new Map();

/* ================= PAINEL RENDER ================= */
async function atualizarPainel() {
  try {
    const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

    const status = telefones.map(t =>
      estadoTelefones[t]
        ? `🔴 ${t} — ${estadoTelefones[t].nome}`
        : `🟢 ${t} — Livre`
    ).join('\n');

    const botoesTelefone = telefones.map(t =>
      new ButtonBuilder()
        .setCustomId(`entrar_${t}`)
        .setLabel(`📞 ${t}`)
        .setStyle(ButtonStyle.Success)
    );

    const rows = [];
    for (let i = 0; i < botoesTelefone.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
    }

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Secondary)
      )
    );

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

    if (mensagemPainelId) {
      try {
        const msg = await canal.messages.fetch(mensagemPainelId);
        await msg.edit({ content: texto, components: rows });
        return;
      } catch {
        mensagemPainelId = null;
      }
    }

    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;

  } catch (err) {
    console.error('ERRO AO ATUALIZAR PAINEL:', err);
  }
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
          .setLabel('📂 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ENTRAR TELEFONE ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel]) {
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      }

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      if (!atendimentosAtivos.has(interaction.user.id)) {
        atendimentosAtivos.set(interaction.user.id, []);
      }

      atendimentosAtivos.get(interaction.user.id).push(tel);

      await interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
      await atualizarPainel();
      return;
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      for (const tel of lista) {
        delete estadoTelefones[tel];
      }

      atendimentosAtivos.delete(interaction.user.id);

      await interaction.reply({ content: '📴 Desconectado de todos', ephemeral: true });
      await atualizarPainel();
      return;
    }

    /* ===== SAIR UM ===== */
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      if (!lista.length) {
        return interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', ephemeral: true });
      }

      return interaction.reply({
        content: 'Selecione o telefone para sair:',
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Escolha o telefone')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];

      if (!estadoTelefones[tel]) {
        return interaction.update({ content: '⚠️ Telefone já estava livre.', components: [] });
      }

      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        interaction.user.id,
        (atendimentosAtivos.get(interaction.user.id) || []).filter(t => t !== tel)
      );

      await interaction.update({ content: `📴 Saiu do **${tel}**`, components: [] });
      await atualizarPainel();
      return;
    }

    /* ===== FORÇAR ===== */
    if (interaction.isButton() && interaction.customId === 'menu_forcar') {
      const ocupados = Object.keys(estadoTelefones);

      if (!ocupados.length) {
        return interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
      }

      return interaction.reply({
        content: 'Selecione o telefone para forçar:',
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('forcar_tel')
              .setPlaceholder('Escolha o telefone')
              .addOptions(ocupados.map(t => ({
                label: `${t} — ${estadoTelefones[t].nome}`,
                value: t
              })))
          )
        ]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const tel = interaction.values[0];

      if (!estadoTelefones[tel]) {
        return interaction.update({ content: '⚠️ Telefone já estava livre.', components: [] });
      }

      const userId = estadoTelefones[tel].userId;

      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        userId,
        (atendimentosAtivos.get(userId) || []).filter(t => t !== tel)
      );

      await interaction.update({ content: `⚠️ **${tel}** desconectado à força.`, components: [] });
      await atualizarPainel();
      return;
    }

    /* ===== TRANSFERIR ===== */
    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const ocupados = Object.keys(estadoTelefones);

      if (!ocupados.length) {
        return interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
      }

      return interaction.reply({
        content: 'Selecione o telefone para transferir:',
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('transferir_tel')
              .setPlaceholder('Escolha o telefone')
              .addOptions(ocupados.map(t => ({
                label: `${t} — ${estadoTelefones[t].nome}`,
                value: t
              })))
          )
        ]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      telefoneSelecionado.set(interaction.user.id, interaction.values[0]);

      return interaction.update({
        content: 'Agora selecione o usuário:',
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId('transferir_user')
              .setPlaceholder('Escolha o usuário')
          )
        ]
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = telefoneSelecionado.get(interaction.user.id);
      telefoneSelecionado.delete(interaction.user.id);

      if (!tel || !estadoTelefones[tel]) {
        return interaction.update({ content: '❌ Transferência inválida.', components: [] });
      }

      const antigoUserId = estadoTelefones[tel].userId;
      const novoUserId = interaction.values[0];

      atendimentosAtivos.set(
        antigoUserId,
        (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel)
      );

      estadoTelefones[tel] = {
        userId: novoUserId,
        nome: interaction.guild.members.cache.get(novoUserId)?.user.username || 'Usuário'
      };

      if (!atendimentosAtivos.has(novoUserId)) {
        atendimentosAtivos.set(novoUserId, []);
      }

      atendimentosAtivos.get(novoUserId).push(tel);

      await interaction.update({ content: `🔁 **${tel}** transferido.`, components: [] });
      await atualizarPainel();
      return;
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

/* ================= PROTEÇÃO GLOBAL ================= */
process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
