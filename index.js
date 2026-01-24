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
const fs = require('fs');
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

/* ================= ESTADO ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();
const ticketsAbertos = new Map();
let mensagemPainelId = null;
let mensagemRelatorioId = null;
const logsRelatorio = [];

/* ================= HELPERS ================= */
async function responder(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({ ...payload, flags: 64 });
    }
    return await interaction.reply({ ...payload, flags: 64 });
  } catch (err) {
    console.error('❌ ERRO AO RESPONDER:', err);
  }
}

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

function logPainel(texto) {
  fs.appendFileSync('./logs/painel.log', `[${horarioBrasilia()}] ${texto}\n`);
}

function logTicket(texto) {
  fs.appendFileSync('./logs/ticket.log', `[${horarioBrasilia()}] ${texto}\n`);
}

/* ================= RELATÓRIO ================= */
async function enviarRelatorio(acao, detalhes) {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);
  logsRelatorio.push(`[${horarioBrasilia()}] ${acao} — ${detalhes}`);
  const texto = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.slice(-30).join('\n')}`;
  let msg = null;
  if (mensagemRelatorioId) {
    try {
      msg = await canal.messages.fetch(mensagemRelatorioId);
    } catch {
      mensagemRelatorioId = null;
    }
  }
  if (!msg) {
    msg = await canal.send(texto);
    mensagemRelatorioId = msg.id;
  } else {
    await msg.edit(texto);
  }
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);
  let msg = null;
  if (mensagemPainelId) {
    try {
      msg = await canal.messages.fetch(mensagemPainelId);
    } catch {
      mensagemPainelId = null;
    }
  }

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      telefones.map(t =>
        new ButtonBuilder()
          .setCustomId(`entrar_${t}`)
          .setLabel(`📞 ${t}`)
          .setStyle(ButtonStyle.Success)
      )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sair_todos')
        .setLabel('🔴 Desconectar TODOS')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('menu_sair')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('menu_transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('menu_forcar')
        .setLabel('⚠️ Forçar')
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  if (!msg) {
    msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;
  } else {
    await msg.edit({ content: texto, components: rows });
  }

  logPainel('Painel atualizado');
}

/* ================= TICKET ROW ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_salvar')
      .setLabel('💾 Salvar')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_fechar')
      .setLabel('🔒 Fechar')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_abrir')
      .setLabel('🔓 Abrir')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ticket_excluir')
      .setLabel('🗑 Excluir')
      .setStyle(ButtonStyle.Danger)
  );
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log('✅ Bot online');

  // Atualiza painel
  await atualizarPainel();

  // Mensagem inicial para abrir ticket
  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);
  await canalTicket.send({
    content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
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
    // ===== PAINEL =====
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID))
        return responder(interaction, { content: '🚫 Apenas telefonistas.' });

      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel])
        return responder(interaction, { content: '⚠️ Telefone ocupado.' });

      estadoTelefones[tel] = { userId: interaction.user.id, nome: interaction.user.username };
      atendimentosAtivos.set(interaction.user.id, [
        ...(atendimentosAtivos.get(interaction.user.id) || []),
        tel
      ]);

      await atualizarPainel();
      await enviarRelatorio('📞 Conectou', `${interaction.user.username} → ${tel}`);
      return responder(interaction, { content: `📞 Conectado ao ${tel}` });
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      lista.forEach(t => delete estadoTelefones[t]);
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();
      return responder(interaction, { content: '📴 Desconectado de todos.' });
    }

    // ===== TICKET =====
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (ticketsAbertos.has(interaction.user.id))
        return responder(interaction, { content: '⚠️ Você já tem ticket aberto.' });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);
      await canal.send({ content: `🎫 Ticket de <@${interaction.user.id}>`, components: [rowTicket()] });
      return responder(interaction, { content: `✅ Ticket criado: ${canal}` });
    }

    // Fechar
    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      const donoId = [...ticketsAbertos.entries()].find(([_, cid]) => cid === interaction.channel.id)?.[0];
      if (!donoId) return;

      await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false });
      if (!interaction.channel.name.endsWith('-fechado')) {
        await interaction.channel.setName(interaction.channel.name.replace('-aberto', '') + '-fechado');
      }

      return responder(interaction, { content: '🔒 Ticket fechado.' });
    }

    // Abrir
    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const donoId = [...ticketsAbertos.entries()].find(([_, cid]) => cid === interaction.channel.id)?.[0];
      if (donoId) {
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true });
      }

      await interaction.channel.setName(interaction.channel.name.replace('-fechado', '') + '-aberto');
      return responder(interaction, { content: '🔓 Ticket reaberto.' });
    }

    // Salvar
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');

      // Salva no canal transcript
      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
      await canalTranscript.send({ content: `📄 **Transcript — ${interaction.channel.name}**\n\n\`\`\`\n${transcript || 'Sem mensagens'}\n\`\`\`` });

      // Envia DM pro dono
      const donoId = [...ticketsAbertos.entries()].find(([_, cid]) => cid === interaction.channel.id)?.[0];
      if (donoId) {
        try {
          const user = await client.users.fetch(donoId);
          await user.send(`💾 Seu ticket **${interaction.channel.name}** foi salvo.\nConfira no canal transcript.`);
        } catch {}
      }

      return responder(interaction, { content: '💾 Transcript salvo e enviado ao dono.' });
    }

    // Excluir
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      await responder(interaction, { content: '🗑 Ticket será apagado...' });
      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 3000);
    }

  } catch (err) {
    console.error('❌ ERRO INTERAÇÃO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((_, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
