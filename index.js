/**
 * index.js — Bot Discord (Render) — Painel de Presença + Tickets
 * ✅ Painel de Presença SEM limitação de cargo (qualquer um pode usar, inclusive "Forçar")
 * ✅ Painel NÃO some / NÃO duplica: mensagem do painel é fixada por ID no TOPIC do canal (presenca-panel:<messageId>)
 * ✅ Menus: Desconectar UM, Transferir (telefone -> membro), Forçar (telefone)
 * ✅ Notificações do painel são ephemeral e tentam sumir depois
 * ✅ Tickets: staff limita reabrir/salvar/excluir; salvar transcript gera resumo, DM pro dono e apaga o canal
 * ✅ Render-safe: logs não derrubam processo, HTTP healthcheck, harden errors
 */

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
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

// IDs (os seus)
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_STAFF_ID = '838753379332915280';

/* ================= LOGS (Render-safe) ================= */
const logsDir = path.resolve(process.cwd(), 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
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
// Presença
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;

// Tickets
const ticketsAbertos = new Map(); // userId -> channelId

// Fluxos de menu do painel
const fluxoPresenca = new Map(); // userId -> { action, step, telefone? }

/* ================= HELPERS ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}

// Ephemeral (flags)
async function responder(interaction, payload) {
  try {
    const data = { ...payload, flags: 64 };
    if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch {}
}

// Ephemeral que tenta sumir depois
async function responderTemp(interaction, payload, ms = 7000) {
  try {
    const data = { ...payload, flags: 64 };
    let sent;
    if (interaction.replied || interaction.deferred) sent = await interaction.followUp(data);
    else sent = await interaction.reply(data);

    setTimeout(async () => {
      try { await interaction.deleteReply().catch(() => {}); } catch {}
      try { if (sent?.deletable) await sent.delete().catch(() => {}); } catch {}
    }, ms);

    return sent;
  } catch {}
}

// Ack rápido p/ evitar "interação falhou" em ações de ticket
async function ackEphemeral(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 }).catch(() => {});
    }
  } catch {}
}
async function finalizeAck(interaction, content) {
  try {
    if (interaction.deferred && !interaction.replied) {
      return await interaction.editReply({ content, flags: 64 }).catch(() => {});
    }
    return await responder(interaction, { content });
  } catch {}
}

function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const match = topic.match(/ticket-owner:(\d+)/);
  return match ? match[1] : null;
}

/* ================= UI BUILDERS ================= */
function rowTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🔓 Abrir').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger),
  );
}

function buildPainelPresencaPayload() {
  const linhas = telefones.map(t => {
    const st = estadoTelefones[t] || 'Livre';
    const bolinha =
      (st.toLowerCase().includes('bina') || st.toLowerCase().includes('ocup') || st.includes('<@'))
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
    new ButtonBuilder().setCustomId('presenca_desconectar_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('presenca_desconectar_um').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('presenca_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('presenca_forcar').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Secondary),
  );

  return {
    content: `📞 **PAINEL DE PRESENÇA**\n\n${linhas}`,
    components: [rowTelefones, rowAcoes],
  };
}

function menuTelefones(customId, { apenasOcupados = false, placeholder = 'Selecione um telefone' } = {}) {
  const options = telefones
    .filter(t => !apenasOcupados || ((estadoTelefones[t] || 'Livre') !== 'Livre'))
    .map(t => ({
      label: t,
      value: t,
      description: `Status: ${estadoTelefones[t] || 'Livre'}`.slice(0, 100),
    }));

  const safeOptions = options.length
    ? options
    : [{ label: 'Nenhum disponível', value: '__none__', description: 'Não há telefones para selecionar.' }];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(safeOptions)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function menuUsuario(customId, placeholder = 'Selecione o membro') {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

/* ================= UPSERT PAINÉIS ================= */
async function upsertPainelTicket() {
  const canal = await client.channels.fetch(CANAL_ABRIR_TICKET_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const payload = {
    content: '🎫 **ATENDIMENTO — ABRIR TICKET**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('abrir_ticket').setLabel('📂 Abrir Ticket').setStyle(ButtonStyle.Primary)
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

/**
 * Painel de presença "à prova de sumiço":
 * - guarda o ID da mensagem no TOPIC do canal: presenca-panel:<messageId>
 * - sempre tenta editar por esse ID
 */
async function upsertPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const topic = canal.topic || '';
  const match = topic.match(/presenca-panel:(\d+)/);
  const topicMsgId = match ? match[1] : null;

  // 1) prioridade: ID gravado no topic
  if (topicMsgId) {
    const msg = await canal.messages.fetch(topicMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      presencaPanelMsgId = msg.id;
      return;
    }
  }

  // 2) fallback: ID em memória
  if (presencaPanelMsgId) {
    const msg = await canal.messages.fetch(presencaPanelMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      await canal.setTopic(`presenca-panel:${msg.id}`).catch(() => {});
      return;
    }
  }

  // 3) fallback: busca mais profunda
  const msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
  const existente = msgs?.find(m =>
    m.author?.id === client.user.id &&
    (m.content || '').includes('📞 **PAINEL DE PRESENÇA**')
  );

  if (existente) {
    presencaPanelMsgId = existente.id;
    await existente.edit(buildPainelPresencaPayload()).catch(() => {});
    await canal.setTopic(`presenca-panel:${existente.id}`).catch(() => {});
    return;
  }

  // 4) cria e grava no topic
  const nova = await canal.send(buildPainelPresencaPayload()).catch(() => null);
  if (nova) {
    presencaPanelMsgId = nova.id;
    await canal.setTopic(`presenca-panel:${nova.id}`).catch(() => {});
  }
}

/* ================= TICKETS: RECONSTRUIR NO BOOT ================= */
async function reconstruirTickets() {
  ticketsAbertos.clear();

  const categoria = await client.channels.fetch(CATEGORIA_TICKET_ID).catch(() => null);
  if (!categoria || !categoria.children) return;

  for (const [, ch] of categoria.children.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    const ownerId = getTicketOwnerIdFromChannel(ch);
    if (ownerId) ticketsAbertos.set(ownerId, ch.id);
  }
  logPainel(`Reconstrução tickets: ${ticketsAbertos.size} encontrados.`);
}

/* ================= TRANSCRIPT: resumo + arquivo ================= */
function buildResumoTicket({ channelName, createdAt, totalMsgs, participantes, primeirasLinhas }) {
  const parts = participantes.length ? participantes.map(p => `- ${p}`).join('\n') : '- (sem participantes)';
  const preview = primeirasLinhas.length ? primeirasLinhas.map(l => `> ${l}`).join('\n') : '> (sem mensagens)';

  return [
    `🧾 **Resumo do Ticket**`,
    `• Canal: **${channelName}**`,
    `• Criado em: **${createdAt}**`,
    `• Total de mensagens (últimas 100): **${totalMsgs}**`,
    `• Participantes:`,
    parts,
    ``,
    `📌 **Prévia (início do histórico):**`,
    preview,
  ].join('\n');
}

async function gerarTranscriptEResumo(channel) {
  const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!msgs) return null;

  const arr = msgs.reverse().toJSON();
  const transcript = arr
    .map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`)
    .join('\n');

  const participantesSet = new Set(arr.map(m => m.author.tag));
  const participantes = Array.from(participantesSet).slice(0, 15);

  const primeirasLinhas = arr
    .slice(0, 6)
    .map(m => `${m.author.username}: ${(m.content || '(sem texto)').replace(/\s+/g, ' ').slice(0, 120)}`);

  const resumo = buildResumoTicket({
    channelName: channel.name,
    createdAt: channel.createdAt?.toLocaleString?.() || new Date().toLocaleString(),
    totalMsgs: arr.length,
    participantes,
    primeirasLinhas,
  });

  return { transcript, resumo };
}

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log('✅ Bot online');
  await reconstruirTickets();
  await upsertPainelTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ================= PAINEL DE PRESENÇA (SEM LIMITAÇÃO) ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      await interaction.deferUpdate().catch(() => {});

      // clique telefone: toggle Livre <-> binabot (você pode trocar depois)
      if (interaction.customId.startsWith('presenca_tel_')) {
        const tel = interaction.customId.replace('presenca_tel_', '');
        if (estadoTelefones[tel] == null) {
          await responderTemp(interaction, { content: '⚠️ Telefone inválido.' }, 5000);
        } else {
          estadoTelefones[tel] = (estadoTelefones[tel] === 'Livre') ? 'binabot' : 'Livre';
          logPainel(`Presença: ${tel} -> ${estadoTelefones[tel]} (por ${interaction.user.tag})`);
        }
        // Atualiza pelo método "topic id" (não some)
        await upsertPainelPresenca();
        return;
      }

      if (interaction.customId === 'presenca_desconectar_todos') {
        for (const t of telefones) estadoTelefones[t] = 'Livre';
        logPainel(`Desconectar TODOS (por ${interaction.user.tag})`);
        await upsertPainelPresenca();
        await responderTemp(interaction, { content: '🔴 Desconectado de todos.' }, 6000);
        return;
      }

      if (interaction.customId === 'presenca_desconectar_um') {
        fluxoPresenca.set(interaction.user.id, { action: 'desconectar_um', step: 'telefone' });
        await responderTemp(interaction, {
          content: '🟠 Selecione o telefone que deseja **desconectar**:',
          components: [menuTelefones('presenca_desconectar_um_select', { apenasOcupados: true, placeholder: 'Telefone para desconectar' })],
        }, 12000);
        return;
      }

      if (interaction.customId === 'presenca_transferir') {
        fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'telefone_origem' });
        await responderTemp(interaction, {
          content: '🔵 Selecione o **telefone de origem** para transferir:',
          components: [menuTelefones('presenca_transferir_tel_select', { apenasOcupados: true, placeholder: 'Telefone de origem' })],
        }, 12000);
        return;
      }

      if (interaction.customId === 'presenca_forcar') {
        fluxoPresenca.set(interaction.user.id, { action: 'forcar', step: 'telefone' });
        await responderTemp(interaction, {
          content: '⚠️ Selecione o telefone para **forçar desconexão**:',
          components: [menuTelefones('presenca_forcar_select', { apenasOcupados: true, placeholder: 'Telefone para forçar' })],
        }, 12000);
        return;
      }

      return;
    }

    /* ================= PAINEL DE PRESENÇA (MENUS) ================= */
    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_desconectar_um_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);

      estadoTelefones[tel] = 'Livre';
      logPainel(`Desconectar UM: ${tel} (por ${interaction.user.tag})`);
      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      return responderTemp(interaction, { content: `✅ ${tel} desconectado.` }, 6000);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_transferir_tel_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);

      fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'usuario', telefone: tel });
      return responderTemp(interaction, {
        content: `🔵 Agora selecione o **membro** para transferir o atendimento do telefone **${tel}**:`,
        components: [menuUsuario('presenca_transferir_user_select', 'Membro destino')],
      }, 12000);
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'presenca_transferir_user_select') {
      await interaction.deferUpdate().catch(() => {});
      const fluxo = fluxoPresenca.get(interaction.user.id);
      if (!fluxo || fluxo.action !== 'transferir' || !fluxo.telefone) {
        return responderTemp(interaction, { content: '⚠️ Fluxo expirou. Clique em Transferir novamente.' }, 7000);
      }

      const userId = interaction.values?.[0];
      if (!userId) return;

      const tel = fluxo.telefone;
      estadoTelefones[tel] = `<@${userId}>`;
      logPainel(`Transferir: ${tel} -> ${userId} (por ${interaction.user.tag})`);

      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      return responderTemp(interaction, { content: `✅ Transferido: **${tel}** agora está com <@${userId}>.` }, 7000);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_forcar_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);

      estadoTelefones[tel] = 'Livre';
      logPainel(`Forçar: ${tel} (por ${interaction.user.tag})`);

      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      return responderTemp(interaction, { content: `⚠️ Forçado: **${tel}** desconectado.` }, 7000);
    }

    /* ================= TICKETS ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackEphemeral(interaction);

      const userId = interaction.user.id;
      const canalIdExistente = ticketsAbertos.get(userId);
      if (canalIdExistente) {
        const ch = interaction.guild.channels.cache.get(canalIdExistente);
        if (ch) return finalizeAck(interaction, `⚠️ Você já tem um ticket aberto: ${ch}`);
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

      await canal.send({ content: `🎫 Ticket de <@${userId}>`, components: [rowTicket()] });

      logPainel(`Ticket aberto por ${interaction.user.tag} (${userId})`);
      return finalizeAck(interaction, `✅ Ticket criado: ${canal}`);
    }

    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      await ackEphemeral(interaction);

      const donoId = getTicketOwnerIdFromChannel(interaction.channel);
      if (!donoId) return finalizeAck(interaction, '⚠️ Não encontrei o dono do ticket.');

      await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false }).catch(() => {});
      const base = interaction.channel.name.replace(/-aberto$/,'').replace(/-fechado$/,'');
      await interaction.channel.setName(`${base}-fechado`).catch(() => {});

      logPainel(`Ticket fechado: ${interaction.channel.name}`);
      return finalizeAck(interaction, '🔒 Ticket fechado.');
    }

    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      await ackEphemeral(interaction);

      if (!isStaff(interaction.member)) return finalizeAck(interaction, '🚫 Apenas staff.');

      const donoId = getTicketOwnerIdFromChannel(interaction.channel);
      if (donoId) {
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true }).catch(() => {});
        ticketsAbertos.set(donoId, interaction.channel.id);
      }

      const base = interaction.channel.name.replace(/-aberto$/,'').replace(/-fechado$/,'');
      await interaction.channel.setName(`${base}-aberto`).catch(() => {});

      logPainel(`Ticket reaberto: ${interaction.channel.name}`);
      return finalizeAck(interaction, '🔓 Ticket reaberto.');
    }

    // salvar transcript: resumo no canal transcript, DM para dono com resumo + txt, apaga ticket
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      await ackEphemeral(interaction);

      if (!isStaff(interaction.member)) return finalizeAck(interaction, '🚫 Apenas staff.');

      const ownerId = getTicketOwnerIdFromChannel(interaction.channel);
      if (!ownerId) return finalizeAck(interaction, '⚠️ Não encontrei o dono do ticket.');

      const data = await gerarTranscriptEResumo(interaction.channel);
      if (!data) return finalizeAck(interaction, '⚠️ Não consegui gerar o transcript.');

      const { transcript, resumo } = data;

      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
      if (canalTranscript?.isTextBased()) {
        const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(resumo truncado)') : resumo;
        await canalTranscript.send({ content: safeResumo }).catch(() => {});
      }

      const user = await client.users.fetch(ownerId).catch(() => null);
      if (user) {
        const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(resumo truncado)') : resumo;
        const buffer = Buffer.from(transcript || 'Sem mensagens', 'utf8');
        const fileName = `transcript-${interaction.channel.name}.txt`;

        await user.send({
          content: `📄 Seu ticket foi salvo e encerrado.\n\n${safeResumo}`,
          files: [{ attachment: buffer, name: fileName }],
        }).catch(() => {});
      }

      ticketsAbertos.delete(ownerId);
      logPainel(`Transcript salvo e ticket encerrado: ${interaction.channel.name}`);

      await finalizeAck(interaction, '💾 Transcript salvo. Este ticket será encerrado e apagado.');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2500);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      await ackEphemeral(interaction);

      if (!isStaff(interaction.member)) return finalizeAck(interaction, '🚫 Apenas staff.');

      const ownerId = getTicketOwnerIdFromChannel(interaction.channel);
      if (ownerId) ticketsAbertos.delete(ownerId);

      logPainel(`Ticket excluído: ${interaction.channel.name}`);
      await finalizeAck(interaction, '🗑 Ticket será apagado em 3s...');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
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
