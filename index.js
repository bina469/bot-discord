require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

// IDs (os seus)
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS (Render-safe) ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
  console.error('❌ Não foi possível criar pasta logs:', e);
}

function logPainel(msg) {
  const logPath = path.join(logsDir, 'painel.log');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toLocaleString()}] ${msg}\n`, 'utf8');
  } catch (err) {
    console.error('❌ Erro ao escrever log do painel:', err);
  }
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* ================= ESTADO ================= */
// Painel de presença
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;

// Tickets (persistente via topic)
const ticketsAbertos = new Map(); // userId -> channelId

/* ================= HELPERS ================= */
async function responder(interaction, payload) {
  try {
    const data = { ...payload, flags: 64 }; // ephemeral sem warning
    if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch {}
}

function isStaffOrTelefonista(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(CARGO_STAFF_ID) || member.roles.cache.has(CARGO_TELEFONISTA_ID);
}

function isStaff(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(CARGO_STAFF_ID);
}

/* ================= UI BUILDERS ================= */
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

function buildPainelPresencaPayload() {
  const linhas = telefones.map(t => {
    const st = estadoTelefones[t] || 'Livre';
    const bolinha = (st.toLowerCase().includes('bina') || st.toLowerCase().includes('ocup'))
      ? '🔴'
      : '🟢';
    return `${bolinha} ${t} — ${st}`;
  }).join('\n');

  const rowTelefones = new ActionRowBuilder().addComponents(
    ...telefones.map(t =>
      new ButtonBuilder()
        .setCustomId(`presenca_tel_${t}`)
        .setLabel(`📞 ${t}`)
        .setStyle(ButtonStyle.Success)
    )
  );

  const rowAcoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('presenca_desconectar_todos')
      .setLabel('🔴 Desconectar TODOS')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('presenca_desconectar_um')
      .setLabel('🟠 Desconectar UM')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('presenca_transferir')
      .setLabel('🔵 Transferir')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('presenca_forcar')
      .setLabel('⚠️ Forçar')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `📞 **PAINEL DE PRESENÇA**\n\n${linhas}`,
    components: [rowTelefones, rowAcoes],
  };
}

/* ================= UPSERT PAINÉIS ================= */
async function upsertPainelTicket() {
  const canal = await client.channels.fetch(CANAL_ABRIR_TICKET_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const payload = {
    content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Abrir Ticket')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };

  const msgs = await canal.messages.fetch({ limit: 25 }).catch(() => null);
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('🎫 **ATENDIMENTO — ABRIR TICKET**')
  );

  if (existente) await existente.edit(payload).catch(() => {});
  else await canal.send(payload).catch(() => {});
}

async function upsertPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  // Se já temos o ID salvo, tenta editar direto
  if (presencaPanelMsgId) {
    const msg = await canal.messages.fetch(presencaPanelMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      return;
    }
  }

  // Se não tem ID (ou sumiu), procura
  const msgs = await canal.messages.fetch({ limit: 25 }).catch(() => null);
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('📞 **PAINEL DE PRESENÇA**')
  );

  if (existente) {
    presencaPanelMsgId = existente.id;
    await existente.edit(buildPainelPresencaPayload()).catch(() => {});
  } else {
    const nova = await canal.send(buildPainelPresencaPayload()).catch(() => null);
    if (nova) presencaPanelMsgId = nova.id;
  }
}

/* ================= TICKETS: RECONSTRUIR NO BOOT ================= */
async function reconstruirTickets() {
  ticketsAbertos.clear();

  const categoria = await client.channels.fetch(CATEGORIA_TICKET_ID).catch(() => null);
  if (!categoria || !categoria.children) return;

  for (const [, ch] of categoria.children.cache) {
    if (ch.type !== ChannelType.GuildText) continue;

    const topic = ch.topic || '';
    const match = topic.match(/ticket-owner:(\d+)/);
    if (match) ticketsAbertos.set(match[1], ch.id);
  }

  logPainel(`Reconstrução tickets: ${ticketsAbertos.size} encontrados.`);
}

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log('✅ Bot online');

  await reconstruirTickets();

  // Sobe/atualiza painéis sem duplicar
  await upsertPainelTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ================= PAINEL DE PRESENÇA ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      // confirma rápido a interação pra não dar "falhou"
      await interaction.deferUpdate().catch(() => {});

      if (!isStaffOrTelefonista(interaction.member)) {
        // responde via followUp ephemeral, já que deferUpdate foi feito
        return responder(interaction, { content: '🚫 Apenas staff/telefonista pode usar o painel de presença.' });
      }

      // Botões de telefone: toggle Livre <-> binabot (teste estável)
      if (interaction.customId.startsWith('presenca_tel_')) {
        const telefone = interaction.customId.replace('presenca_tel_', '');
        if (estadoTelefones[telefone] == null) {
          return responder(interaction, { content: '⚠️ Telefone inválido.' });
        }

        estadoTelefones[telefone] = (estadoTelefones[telefone] === 'Livre') ? 'binabot' : 'Livre';
        logPainel(`Presença: ${telefone} -> ${estadoTelefones[telefone]} (por ${interaction.user.tag})`);
      }

      if (interaction.customId === 'presenca_desconectar_todos') {
        for (const t of telefones) estadoTelefones[t] = 'Livre';
        logPainel(`Desconectar TODOS (por ${interaction.user.tag})`);
      }

      if (interaction.customId === 'presenca_desconectar_um') {
        // aqui você implementa sua regra real depois
        logPainel(`Desconectar UM (por ${interaction.user.tag})`);
        await responder(interaction, { content: '🟠 Ação "Desconectar UM" está em modo teste. Diga a regra real que eu implemento.' });
      }

      if (interaction.customId === 'presenca_transferir') {
        logPainel(`Transferir (por ${interaction.user.tag})`);
        await responder(interaction, { content: '🔵 Ação "Transferir" está em modo teste. Diga a regra real que eu implemento.' });
      }

      if (interaction.customId === 'presenca_forcar') {
        logPainel(`Forçar (por ${interaction.user.tag})`);
        await responder(interaction, { content: '⚠️ Ação "Forçar" está em modo teste. Diga a regra real que eu implemento.' });
      }

      // ✅ atualiza editando a própria mensagem (não duplica)
      await interaction.message.edit(buildPainelPresencaPayload()).catch(async () => {
        // fallback (se a msg não for editável)
        await upsertPainelPresenca();
      });

      return;
    }

    /* ================= ABRIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const userId = interaction.user.id;

      // se tiver ticket no Map, valida se canal existe; senão limpa
      const canalIdExistente = ticketsAbertos.get(userId);
      if (canalIdExistente) {
        const ch = interaction.guild.channels.cache.get(canalIdExistente);
        if (ch) return responder(interaction, { content: `⚠️ Você já tem um ticket aberto: ${ch}` });
        ticketsAbertos.delete(userId);
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ],
      });

      await canal.setTopic(`ticket-owner:${userId}`).catch(() => {});
      ticketsAbertos.set(userId, canal.id);

      await canal.send({
        content: `🎫 Ticket de <@${userId}>`,
        components: [rowTicket()],
      });

      logPainel(`Ticket aberto por ${interaction.user.tag} (${userId})`);
      return responder(interaction, { content: `✅ Ticket criado: ${canal}` });
    }

    /* ================= FECHAR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;
      if (!donoId) return;

      await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false }).catch(() => {});
      if (!interaction.channel.name.endsWith('-fechado')) {
        const novoNome = interaction.channel.name.replace('-aberto', '').replace(/-fechado$/, '') + '-fechado';
        await interaction.channel.setName(novoNome).catch(() => {});
      }

      logPainel(`Ticket fechado: ${interaction.channel.name}`);
      return responder(interaction, { content: '🔒 Ticket fechado.' });
    }

    /* ================= REABRIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      if (!isStaff(interaction.member))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;

      if (donoId) {
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true }).catch(() => {});
        ticketsAbertos.set(donoId, interaction.channel.id);
      }

      const novoNome = interaction.channel.name.replace('-fechado', '').replace(/-aberto$/, '') + '-aberto';
      await interaction.channel.setName(novoNome).catch(() => {});

      logPainel(`Ticket reaberto: ${interaction.channel.name}`);
      return responder(interaction, { content: '🔓 Ticket reaberto.' });
    }

    /* ================= SALVAR TRANSCRIPT ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      if (!isStaff(interaction.member))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const msgs = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs) return responder(interaction, { content: '⚠️ Não consegui buscar mensagens.' });

      const transcript = msgs
        .reverse()
        .map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`)
        .join('\n');

      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
      if (canalTranscript?.isTextBased()) {
        const max = 1800;
        const body = (transcript || 'Sem mensagens');
        const safe = body.length > max ? body.slice(0, max) + '\n...(truncado)' : body;

        await canalTranscript.send({
          content: `📄 **Transcript — ${interaction.channel.name}**\n\`\`\`\n${safe}\n\`\`\``,
        }).catch(() => {});
      }

      logPainel(`Transcript salvo: ${interaction.channel.name}`);
      return responder(interaction, { content: '💾 Transcript salvo.' });
    }

    /* ================= EXCLUIR TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      if (!isStaff(interaction.member))
        return responder(interaction, { content: '🚫 Apenas staff.' });

      const topic = interaction.channel.topic || '';
      const match = topic.match(/ticket-owner:(\d+)/);
      const donoId = match ? match[1] : null;
      if (donoId) ticketsAbertos.delete(donoId);

      await responder(interaction, { content: '🗑 Ticket será apagado em 3s...' });
      logPainel(`Ticket excluído: ${interaction.channel.name}`);

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 3000);
      return;
    }

  } catch (err) {
    console.error('❌ ERRO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HARDEN PROCESS ================= */
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
client.on('error', (err) => console.error('Discord Client error:', err));
client.on('shardError', (err) => console.error('Discord Shard error:', err));

/* ================= HTTP (Render health) ================= */
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot rodando');
}).listen(PORT, () => {
  console.log(`🌐 HTTP na porta ${PORT}`);
});
