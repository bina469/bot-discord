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

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';
const CANAL_RELATORIO_ID = '1458342162981716039';

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

// Fluxos do painel
const fluxoPresenca = new Map(); // userId -> { action, step, telefone? }

/* ================= HELPERS ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}

async function responder(interaction, payload) {
  try {
    const data = { ...payload, flags: 64 };
    if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch {}
}

async function avisarEphemeral(interaction, content, ms = 3500) {
  try {
    const payload = { content, flags: 64 };
    let msg;
    if (interaction.replied || interaction.deferred) msg = await interaction.followUp(payload);
    else msg = await interaction.reply(payload);

    if (msg?.id) {
      setTimeout(() => {
        interaction.webhook?.deleteMessage(msg.id).catch(() => {});
      }, ms);
    }
  } catch {}
}

async function enviarMsgTempNoCanal(channel, payload, ms = 20000) {
  const msg = await channel.send(payload).catch(() => null);
  if (!msg) return null;
  setTimeout(() => msg.delete().catch(() => {}), ms);
  return msg;
}

/**
 * ✅ Ticket buttons: ACK com deferUpdate (não trava "pensando")
 */
async function ackComponent(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
  } catch (e) {
    console.error('ackComponent error:', e);
  }
}

async function followEphemeral(interaction, content, ms = 3500) {
  try {
    const msg = await interaction.followUp({ content, flags: 64 }).catch(() => null);
    if (msg?.id) {
      setTimeout(() => interaction.webhook?.deleteMessage(msg.id).catch(() => {}), ms);
    }
  } catch {}
}

function getTicketOwnerIdFromChannel(channel) {
  const topic = channel?.topic || '';
  const match = topic.match(/ticket-owner:(\d+)/);
  return match ? match[1] : null;
}

function makeTicketName(currentName, status /* 'aberto'|'fechado' */) {
  const base = (currentName || '').replace(/-aberto$/i, '').replace(/-fechado$/i, '');
  return `${base}-${status}`;
}

/**
 * Renomeia com fallback e retry (resolve "não muda o nome")
 */
async function renameChannelRobusto(channel, newName) {
  if (!channel || !newName) return;
  if (channel.name === newName) return;

  try {
    await channel.setName(newName);
    return;
  } catch (e1) {
    console.error('setName falhou:', e1);
  }

  try {
    await channel.edit({ name: newName });
    return;
  } catch (e2) {
    console.error('channel.edit(name) falhou:', e2);
  }

  // retry curto
  try {
    await new Promise(r => setTimeout(r, 800));
    await channel.edit({ name: newName });
  } catch (e3) {
    console.error('retry channel.edit(name) falhou:', e3);
  }
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

async function upsertPainelPresenca() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) return;

  const topic = canal.topic || '';
  const match = topic.match(/presenca-panel:(\d+)/);
  const topicMsgId = match ? match[1] : null;

  if (topicMsgId) {
    const msg = await canal.messages.fetch(topicMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      presencaPanelMsgId = msg.id;
      return;
    }
  }

  if (presencaPanelMsgId) {
    const msg = await canal.messages.fetch(presencaPanelMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      await canal.setTopic(`presenca-panel:${msg.id}`).catch(() => {});
      return;
    }
  }

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

  const nova = await canal.send(buildPainelPresencaPayload()).catch(() => null);
  if (nova) {
    presencaPanelMsgId = nova.id;
    await canal.setTopic(`presenca-panel:${nova.id}`).catch(() => {});
  }
}

async function reconstruirTickets() {
  ticketsAbertos.clear();

  const categoria = await client.channels.fetch(CATEGORIA_TICKET_ID).catch(() => null);
  if (!categoria || !categoria.children) return;

  for (const [, ch] of categoria.children.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    const ownerId = getTicketOwnerIdFromChannel(ch);
    if (ownerId) ticketsAbertos.set(ownerId, ch.id);
  }
}

/* ================= TRANSCRIPT ================= */
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
  const transcript = arr.map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || ''}`).join('\n');

  const participantesSet = new Set(arr.map(m => m.author.tag));
  const participantes = Array.from(participantesSet).slice(0, 15);

  const primeirasLinhas = arr.slice(0, 6).map(m => `${m.author.username}: ${(m.content || '(sem texto)').replace(/\s+/g, ' ').slice(0, 120)}`);

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
    /* ================= PAINEL DE PRESENÇA ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId.startsWith('presenca_tel_')) {
        const tel = interaction.customId.replace('presenca_tel_', '');
        if (estadoTelefones[tel] == null) await avisarEphemeral(interaction, '⚠️ Telefone inválido.', 2500);
        else {
          estadoTelefones[tel] = (estadoTelefones[tel] === 'Livre') ? 'binabot' : 'Livre';
          await avisarEphemeral(interaction, `📞 ${tel}: ${estadoTelefones[tel]}`, 2500);
        }
        await upsertPainelPresenca();
        return;
      }

      if (interaction.customId === 'presenca_desconectar_todos') {
        for (const t of telefones) estadoTelefones[t] = 'Livre';
        await upsertPainelPresenca();
        await avisarEphemeral(interaction, '🔴 Desconectado de todos.', 3000);
        return;
      }

      if (interaction.customId === 'presenca_desconectar_um') {
        fluxoPresenca.set(interaction.user.id, { action: 'desconectar_um', step: 'telefone' });
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🟠 <@${interaction.user.id}>, selecione o telefone que deseja **desconectar**:`,
          components: [menuTelefones('presenca_desconectar_um_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }

      if (interaction.customId === 'presenca_transferir') {
        fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'telefone_origem' });
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `🔵 <@${interaction.user.id}>, selecione o **telefone de origem**:`,
          components: [menuTelefones('presenca_transferir_tel_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }

      if (interaction.customId === 'presenca_forcar') {
        fluxoPresenca.set(interaction.user.id, { action: 'forcar', step: 'telefone' });
        await enviarMsgTempNoCanal(interaction.channel, {
          content: `⚠️ <@${interaction.user.id}>, selecione o telefone para **forçar desconexão**:`,
          components: [menuTelefones('presenca_forcar_select', { apenasOcupados: true })],
        }, 20000);
        return;
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_desconectar_um_select') {
      await interaction.deferUpdate().catch(() => {});
      if (!fluxoPresenca.has(interaction.user.id)) return avisarEphemeral(interaction, '⚠️ Menu expirou.', 2500);
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return avisarEphemeral(interaction, '⚠️ Nenhum telefone disponível.', 2500);

      estadoTelefones[tel] = 'Livre';
      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      interaction.message.delete().catch(() => {});
      await avisarEphemeral(interaction, `✅ ${tel} desconectado.`, 3000);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_transferir_tel_select') {
      await interaction.deferUpdate().catch(() => {});
      if (!fluxoPresenca.has(interaction.user.id)) return avisarEphemeral(interaction, '⚠️ Menu expirou.', 2500);
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return avisarEphemeral(interaction, '⚠️ Nenhum telefone disponível.', 2500);

      fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'usuario', telefone: tel });
      interaction.message.delete().catch(() => {});
      await enviarMsgTempNoCanal(interaction.channel, {
        content: `🔵 <@${interaction.user.id}>, selecione o **membro** para receber **${tel}**:`,
        components: [menuUsuario('presenca_transferir_user_select')],
      }, 20000);
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'presenca_transferir_user_select') {
      await interaction.deferUpdate().catch(() => {});
      const fluxo = fluxoPresenca.get(interaction.user.id);
      if (!fluxo || fluxo.action !== 'transferir' || !fluxo.telefone) return avisarEphemeral(interaction, '⚠️ Fluxo expirou.', 2500);
      const userId = interaction.values?.[0];
      const tel = fluxo.telefone;
      estadoTelefones[tel] = `<@${userId}>`;
      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      interaction.message.delete().catch(() => {});
      await avisarEphemeral(interaction, `✅ Transferido: ${tel} -> <@${userId}>`, 3500);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_forcar_select') {
      await interaction.deferUpdate().catch(() => {});
      if (!fluxoPresenca.has(interaction.user.id)) return avisarEphemeral(interaction, '⚠️ Menu expirou.', 2500);
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') return avisarEphemeral(interaction, '⚠️ Nenhum telefone disponível.', 2500);

      estadoTelefones[tel] = 'Livre';
      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);
      interaction.message.delete().catch(() => {});
      await avisarEphemeral(interaction, `⚠️ Forçado: ${tel} desconectado.`, 3500);
      return;
    }

    /* ================= TICKETS ================= */

    // abrir ticket (criar)
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await ackComponent(interaction);
      try {
        const userId = interaction.user.id;

        const canalIdExistente = ticketsAbertos.get(userId);
        if (canalIdExistente) {
          const ch = interaction.guild.channels.cache.get(canalIdExistente);
          if (ch) {
            await followEphemeral(interaction, `⚠️ Você já tem um ticket aberto: ${ch}`, 4000);
            return;
          }
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

        await followEphemeral(interaction, `✅ Ticket criado: ${canal}`, 4000);
        return;
      } catch (err) {
        console.error('❌ abrir_ticket:', err);
        await followEphemeral(interaction, '⚠️ Erro ao criar o ticket.', 5000);
        return;
      }
    }

    // fechar (dono OU staff)
    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      await ackComponent(interaction);
      try {
        const donoId = getTicketOwnerIdFromChannel(interaction.channel);
        if (!donoId) return followEphemeral(interaction, '⚠️ Dono do ticket não encontrado.', 5000);

        const autorizado = (interaction.user.id === donoId) || isStaff(interaction.member);
        if (!autorizado) return followEphemeral(interaction, '🚫 Apenas dono ou staff pode FECHAR.', 4500);

        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false });
        await renameChannelRobusto(interaction.channel, makeTicketName(interaction.channel.name, 'fechado'));

        await followEphemeral(interaction, '🔒 Ticket fechado.', 3500);
        return;
      } catch (err) {
        console.error('❌ ticket_fechar:', err);
        await followEphemeral(interaction, '⚠️ Erro ao fechar ticket (veja logs).', 6000);
        return;
      }
    }

    // excluir (dono OU staff)
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      await ackComponent(interaction);
      try {
        const donoId = getTicketOwnerIdFromChannel(interaction.channel);
        if (!donoId) return followEphemeral(interaction, '⚠️ Dono do ticket não encontrado.', 5000);

        const autorizado = (interaction.user.id === donoId) || isStaff(interaction.member);
        if (!autorizado) return followEphemeral(interaction, '🚫 Apenas dono ou staff pode EXCLUIR.', 4500);

        ticketsAbertos.delete(donoId);
        await followEphemeral(interaction, '🗑 Ticket será apagado em 2s...', 2000);
        setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
        return;
      } catch (err) {
        console.error('❌ ticket_excluir:', err);
        await followEphemeral(interaction, '⚠️ Erro ao excluir ticket.', 6000);
        return;
      }
    }

    // abrir/reabrir (somente staff)
    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      await ackComponent(interaction);
      try {
        if (!isStaff(interaction.member)) return followEphemeral(interaction, '🚫 Apenas staff pode ABRIR (reabrir).', 4500);

        const donoId = getTicketOwnerIdFromChannel(interaction.channel);
        if (!donoId) return followEphemeral(interaction, '⚠️ Dono do ticket não encontrado.', 5000);

        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true });
        ticketsAbertos.set(donoId, interaction.channel.id);

        await renameChannelRobusto(interaction.channel, makeTicketName(interaction.channel.name, 'aberto'));

        await followEphemeral(interaction, '🔓 Ticket reaberto.', 3500);
        return;
      } catch (err) {
        console.error('❌ ticket_abrir:', err);
        await followEphemeral(interaction, '⚠️ Erro ao reabrir ticket (veja logs).', 6000);
        return;
      }
    }

    // salvar (somente staff) + apaga canal
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      await ackComponent(interaction);
      try {
        if (!isStaff(interaction.member)) return followEphemeral(interaction, '🚫 Apenas staff pode SALVAR.', 4500);

        const ownerId = getTicketOwnerIdFromChannel(interaction.channel);
        if (!ownerId) return followEphemeral(interaction, '⚠️ Dono do ticket não encontrado.', 5000);

        const data = await gerarTranscriptEResumo(interaction.channel);
        if (!data) return followEphemeral(interaction, '⚠️ Não consegui gerar transcript.', 5000);

        const { transcript, resumo } = data;
        const safeResumo = resumo.length > 1900 ? (resumo.slice(0, 1900) + '\n...(truncado)') : resumo;

        const canalRelatorio = await client.channels.fetch(CANAL_RELATORIO_ID).catch(() => null);
        if (canalRelatorio?.isTextBased()) await canalRelatorio.send({ content: safeResumo }).catch(() => {});

        const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
        if (canalTranscript?.isTextBased()) await canalTranscript.send({ content: safeResumo }).catch(() => {});

        const user = await client.users.fetch(ownerId).catch(() => null);
        if (user) {
          const buffer = Buffer.from(transcript || 'Sem mensagens', 'utf8');
          const fileName = `transcript-${interaction.channel.name}.txt`;
          await user.send({
            content: `📄 Seu ticket foi salvo e encerrado.\n\n${safeResumo}`,
            files: [{ attachment: buffer, name: fileName }],
          }).catch(() => {});
        }

        ticketsAbertos.delete(ownerId);

        await followEphemeral(interaction, '💾 Salvo. Ticket será apagado em 2.5s...', 2500);
        setTimeout(() => interaction.channel.delete().catch(() => {}), 2500);
        return;
      } catch (err) {
        console.error('❌ ticket_salvar:', err);
        await followEphemeral(interaction, '⚠️ Erro ao salvar transcript (veja logs).', 6000);
        return;
      }
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
