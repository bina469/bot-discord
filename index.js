/**
 * index.js — Bot Discord (Render) — Painel de Presença + Tickets
 * - Painel de Presença SEM limitação de cargo (qualquer um pode usar, inclusive "Forçar")
 * - Tickets com limitação (somente STAFF pode reabrir/salvar/excluir)
 * - Painéis não duplicam (upsert -> edita mensagem existente)
 * - Menus de: Desconectar UM, Transferir (telefone -> membro), Forçar (telefone)
 * - Notificações do painel (ephemeral) tentam sumir após alguns segundos
 * - Logs render-safe (não derruba o processo)
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

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

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
// Presença
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = Object.fromEntries(telefones.map(t => [t, 'Livre']));
let presencaPanelMsgId = null;

// Tickets
const ticketsAbertos = new Map(); // userId -> channelId

// Fluxos de menu (desconectar_um, transferir, forcar)
const fluxoPresenca = new Map(); // userId -> { action, step, telefone? }

/* ================= HELPERS ================= */
function isStaff(member) {
  return !!member?.roles?.cache?.has(CARGO_STAFF_ID);
}

async function responder(interaction, payload) {
  try {
    const data = { ...payload, flags: 64 }; // ephemeral
    if (interaction.replied || interaction.deferred) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch {}
}

// Ephemeral que tenta sumir depois de X ms
async function responderTemp(interaction, payload, ms = 7000) {
  try {
    const data = { ...payload, flags: 64 }; // ephemeral
    let sent;
    if (interaction.replied || interaction.deferred) sent = await interaction.followUp(data);
    else sent = await interaction.reply(data);

    setTimeout(async () => {
      try {
        await interaction.deleteReply().catch(() => {});
      } catch {}
      try {
        if (sent?.deletable) await sent.delete().catch(() => {});
      } catch {}
    }, ms);

    return sent;
  } catch {}
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

function menuTelefones(customId, { apenasOcupados = false, placeholder = 'Selecione um telefone' } = {}) {
  const options = telefones
    .filter(t => !apenasOcupados || ((estadoTelefones[t] || 'Livre') !== 'Livre'))
    .map(t => ({
      label: t,
      value: t,
      description: `Status: ${estadoTelefones[t] || 'Livre'}`.slice(0, 100),
    }));

  // Se não houver opções, cria uma "fake" pra não quebrar o menu
  const safeOptions = options.length ? options : [{ label: 'Nenhum disponível', value: '__none__', description: 'Não há telefones para selecionar.' }];

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

  if (presencaPanelMsgId) {
    const msg = await canal.messages.fetch(presencaPanelMsgId).catch(() => null);
    if (msg) {
      await msg.edit(buildPainelPresencaPayload()).catch(() => {});
      return;
    }
  }

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
  await upsertPainelTicket();
  await upsertPainelPresenca();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async (interaction) => {
  try {
    /* ================= PAINEL DE PRESENÇA (BOTÕES) ================= */
    if (interaction.isButton() && interaction.customId.startsWith('presenca_')) {
      // Importantíssimo: responde rápido pra não falhar
      await interaction.deferUpdate().catch(() => {});

      // Clique em telefone: toggle Livre <-> binabot (você pode trocar pela lógica real depois)
      if (interaction.customId.startsWith('presenca_tel_')) {
        const tel = interaction.customId.replace('presenca_tel_', '');
        if (estadoTelefones[tel] == null) {
          await responderTemp(interaction, { content: '⚠️ Telefone inválido.' }, 5000);
        } else {
          estadoTelefones[tel] = (estadoTelefones[tel] === 'Livre') ? 'binabot' : 'Livre';
          logPainel(`Presença: ${tel} -> ${estadoTelefones[tel]} (por ${interaction.user.tag})`);
        }

        await interaction.message.edit(buildPainelPresencaPayload()).catch(() => upsertPainelPresenca());
        return;
      }

      // Desconectar TODOS
      if (interaction.customId === 'presenca_desconectar_todos') {
        for (const t of telefones) estadoTelefones[t] = 'Livre';
        logPainel(`Desconectar TODOS (por ${interaction.user.tag})`);

        await interaction.message.edit(buildPainelPresencaPayload()).catch(() => upsertPainelPresenca());
        await responderTemp(interaction, { content: '🔴 Desconectado de todos.' }, 6000);
        return;
      }

      // Desconectar UM (abre menu)
      if (interaction.customId === 'presenca_desconectar_um') {
        fluxoPresenca.set(interaction.user.id, { action: 'desconectar_um', step: 'telefone' });

        await responderTemp(interaction, {
          content: '🟠 Selecione o telefone que deseja **desconectar**:',
          components: [menuTelefones('presenca_desconectar_um_select', { apenasOcupados: true, placeholder: 'Telefone para desconectar' })],
        }, 12000);

        return;
      }

      // Transferir (menu telefone -> menu usuário)
      if (interaction.customId === 'presenca_transferir') {
        fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'telefone_origem' });

        await responderTemp(interaction, {
          content: '🔵 Selecione o **telefone de origem** para transferir:',
          components: [menuTelefones('presenca_transferir_tel_select', { apenasOcupados: true, placeholder: 'Telefone de origem' })],
        }, 12000);

        return;
      }

      // Forçar (abre menu telefone)
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
    // Desconectar UM: seleciona telefone
    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_desconectar_um_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') {
        return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);
      }

      estadoTelefones[tel] = 'Livre';
      logPainel(`Desconectar UM: ${tel} (por ${interaction.user.tag})`);

      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);

      return responderTemp(interaction, { content: `✅ ${tel} desconectado.` }, 6000);
    }

    // Transferir: seleciona telefone origem
    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_transferir_tel_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') {
        return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);
      }

      fluxoPresenca.set(interaction.user.id, { action: 'transferir', step: 'usuario', telefone: tel });

      return responderTemp(interaction, {
        content: `🔵 Agora selecione o **membro** para transferir o atendimento do telefone **${tel}**:`,
        components: [menuUsuario('presenca_transferir_user_select', 'Membro destino')],
      }, 12000);
    }

    // Transferir: seleciona usuário destino
    if (interaction.isUserSelectMenu() && interaction.customId === 'presenca_transferir_user_select') {
      await interaction.deferUpdate().catch(() => {});

      const fluxo = fluxoPresenca.get(interaction.user.id);
      if (!fluxo || fluxo.action !== 'transferir' || !fluxo.telefone) {
        return responderTemp(interaction, { content: '⚠️ Fluxo expirou. Clique em Transferir novamente.' }, 7000);
      }

      const userId = interaction.values?.[0];
      if (!userId) return;

      const tel = fluxo.telefone;
      estadoTelefones[tel] = `<@${userId}>`; // mostra no painel quem está com o telefone

      logPainel(`Transferir: ${tel} -> ${userId} (por ${interaction.user.tag})`);

      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);

      return responderTemp(interaction, { content: `✅ Transferido: **${tel}** agora está com <@${userId}>.` }, 7000);
    }

    // Forçar: seleciona telefone e desconecta
    if (interaction.isStringSelectMenu() && interaction.customId === 'presenca_forcar_select') {
      await interaction.deferUpdate().catch(() => {});
      const tel = interaction.values?.[0];
      if (!tel || tel === '__none__') {
        return responderTemp(interaction, { content: '⚠️ Nenhum telefone disponível.' }, 6000);
      }

      estadoTelefones[tel] = 'Livre';
      logPainel(`Forçar: ${tel} (por ${interaction.user.tag})`);

      await upsertPainelPresenca();
      fluxoPresenca.delete(interaction.user.id);

      return responderTemp(interaction, { content: `⚠️ Forçado: **${tel}** desconectado.` }, 7000);
    }

    /* ================= TICKETS ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const userId = interaction.user.id;

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

    // Fechar ticket (pode ser por qualquer um, se quiser limitar, coloque isStaff aqui)
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

    // Reabrir ticket (somente staff)
    if (interaction.isButton() && interaction.customId === 'ticket_abrir') {
      if (!isStaff(interaction.member)) return responder(interaction, { content: '🚫 Apenas staff.' });

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

    // Salvar transcript (somente staff)
    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      if (!isStaff(interaction.member)) return responder(interaction, { content: '🚫 Apenas staff.' });

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

    // Excluir ticket (somente staff)
    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      if (!isStaff(interaction.member)) return responder(interaction, { content: '🚫 Apenas staff.' });

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
