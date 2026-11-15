<template>
  <div>
    <div v-if="!activeSection" class="card">
      <strong>设置</strong>
      <p class="hint">选择一个设置项，不用在长页面里上下找。</p>
      <div class="settings-grid">
        <button v-for="s in sections" :key="s.id" class="setting-tile" @click="openSection(s.id)">
          <span class="setting-icon">{{ s.icon }}</span>
          <b>{{ s.name }}</b>
          <small>{{ s.desc }}</small>
        </button>
        <a href="/manager" class="setting-tile">
          <span class="setting-icon">💻</span>
          <b>管理后台</b>
          <small>电脑端批量管理</small>
        </a>
      </div>
    </div>

    <div v-else class="card">
      <button class="btn secondary" style="margin-bottom:12px" @click="activeSection = ''">← 返回设置</button>

      <template v-if="activeSection === 'translation'">
        <strong>翻译设置</strong>
        <p class="hint">翻译顺序：白名单直接跳过；然后按下面选择的优先级。</p>
        <label>优先顺序</label>
        <select v-model="priority" class="input">
          <option value="local-free-llm">本地词典 → 免费词典 → 大模型</option>
          <option value="free-local-llm">免费词典 → 本地词典 → 大模型</option>
          <option value="llm-local-free">大模型 → 本地词典 → 免费词典</option>
        </select>

        <div class="setting-line">
          <div><b>免费词典</b><div class="hint">MyMemory，无需 Key；今日已用 {{ freeUsed }} / 5000 字</div></div>
          <input type="checkbox" v-model="freeEnabled" style="width:20px;height:20px" />
        </div>

        <div class="setting-line">
          <div><b>大模型</b><div class="hint">选择厂商，填 API Key 即可；模型可选，也可自定义。</div></div>
        </div>
        <label>厂商</label>
        <select v-model="llmProvider" class="input" @change="onProviderChange">
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <label>API Key</label>
        <input v-model="llmKey" class="input" type="password" :placeholder="llmHasKey ? '已保存，留空表示不修改' : '填写厂商 API Key'" />
        <label>模型</label>
        <div class="row" style="gap:6px;align-items:center">
          <select v-if="modelOptions.length" v-model="llmModel" class="input" style="flex:1">
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            <option value="__custom">自定义模型…</option>
          </select>
          <button class="btn secondary" style="padding:8px 10px;white-space:nowrap" :disabled="modelsLoading" @click="refreshModels">
            {{ modelsLoading ? '获取中…' : '刷新模型' }}
          </button>
        </div>
        <input v-if="llmModel === '__custom' || !currentProvider.models.length" v-model="llmModelCustom" class="input" placeholder="模型名，例如 deepseek-chat" style="margin-top:6px" />
        <label v-if="llmProvider === 'custom'">自定义 Base URL</label>
        <input v-if="llmProvider === 'custom'" v-model="llmBase" class="input" placeholder="https://api.example.com/v1" />
        <button class="btn" style="margin-top:10px" @click="saveLlm">保存大模型配置</button>

        <div class="section-title">本地词典</div>
        <p class="hint">中文和西班牙语对照，完全匹配时直接使用，不请求网络。</p>
        <div v-for="(row, i) in dictRows" :key="i" class="dict-row">
          <input v-model="row.zh" class="input" placeholder="中文" />
          <input v-model="row.es" class="input" placeholder="Español" />
          <button class="dock-mini" @click="dictRows.splice(i, 1)">删除</button>
        </div>
        <button class="btn secondary" style="margin-top:10px" @click="dictRows.push({ zh: '', es: '' })">+ 添加词条</button>

        <div class="section-title">不翻译词组白名单</div>
        <p class="hint">命中的词组保持原样，不送去翻译。例如：LED、USB、型号、单位。</p>
        <div class="tag-row">
          <span v-for="(w, i) in whitelist" :key="i" class="tag">{{ w }} <button @click="whitelist.splice(i, 1)">×</button></span>
        </div>
        <div class="row" style="margin-top:8px">
          <input v-model="newWord" class="input" placeholder="输入词组，回车添加" @keyup.enter="addWord" />
          <button class="btn secondary" @click="addWord">添加</button>
        </div>

        <button class="btn" style="margin-top:16px" @click="saveTranslation">保存翻译设置</button>
      </template>

      <template v-else-if="activeSection === 'reuse'">
        <strong>水印内容复用</strong>
        <label style="display:flex;gap:10px;align-items:center;margin-top:12px;color:var(--text);font-size:14px">
          <input type="checkbox" v-model="reuse" style="width:20px;height:20px" @change="saveReuse" />
          拍照后保留水印内容，下一张继续使用
        </label>
        <p class="hint">开启：拍完下一张还保留；关闭：拍完自动清空字段（模板/样式仍保留）。</p>
      </template>

      <template v-else-if="activeSection === 'shares'">
        <strong>分享链接</strong>
        <p class="hint">这里列出当前有效的分享，可随时撤回。</p>
        <div v-if="shares.length === 0" class="hint">暂无有效分享</div>
        <div v-for="s in shares" :key="s.token" style="border-top:1px solid var(--line);padding:8px 0">
          <div class="hint">{{ s.folderName || '照片分享' }} · {{ s.count }} 张 · 到期 {{ new Date(s.expiresAt).toLocaleString() }}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
            <a :href="s.url" target="_blank" style="font-size:12px;color:var(--teal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{{ location.origin + s.url }}</a>
            <button class="btn danger" style="padding:6px 10px;font-size:12px" @click="revoke(s.token)">撤回</button>
          </div>
        </div>
      </template>

      <template v-else-if="activeSection === 'account'">
        <strong>账户</strong>
        <p class="hint">当前登录：{{ me?.username || '…' }}（{{ me?.role === 'admin' ? '管理员' : '员工' }}）</p>
        <div class="section-title">修改我的密码</div>
        <input v-model="oldPassword" class="input" type="password" placeholder="旧密码" autocomplete="current-password" />
        <input v-model="newPassword" class="input" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" style="margin-top:6px" />
        <button class="btn" style="margin-top:8px" @click="changePassword">修改密码</button>

        <template v-if="me?.role === 'admin'">
          <div class="section-title">员工账号</div>
          <p class="hint">每个账号的照片、文件夹、导出和分享互相独立；管理员可看到全部。</p>
          <div class="row" style="gap:6px">
            <input v-model="newUsername" class="input" placeholder="用户名" />
            <input v-model="newUserPassword" class="input" type="password" placeholder="初始密码" />
            <button class="btn secondary" @click="createUser">创建</button>
          </div>
          <div v-for="u in users" :key="u.id" class="setting-line">
            <div><b>{{ u.username }}</b><span class="hint"> · {{ u.role }}</span></div>
            <div class="row">
              <button class="dock-mini" @click="resetPassword(u)">重置密码</button>
              <button v-if="u.id !== me?.id" class="dock-mini" style="background:#dc2626" @click="deleteUser(u)">删除</button>
            </div>
          </div>
        </template>

        <button class="btn danger" style="margin-top:16px" @click="logout">退出登录</button>
      </template>

      <template v-else-if="activeSection === 'storage'">
        <strong>存储</strong>
        <p class="hint">当前使用服务器本地存储，照片保存在服务器数据盘。后续可切换阿里云 OSS，不需要改使用方式。</p>
        <p class="hint">服务器盘不是唯一备份；请定期导出/备份重要照片。</p>
      </template>

      <template v-else-if="activeSection === 'about'">
        <strong>关于</strong>
        <p class="hint">Safari iOS 17+（主）、Chrome 桌面/Android ≥120（正式）。Chrome iOS 使用 WebKit，尽力支持。</p>
        <p class="hint">微信内不支持实时拍照；请用 Safari/Chrome 打开。</p>
        <h3 style="margin-top:16px">安装到主屏幕</h3>
        <p class="hint">iPhone Safari：点底部“分享” → “添加到主屏幕”。<br />Chrome 桌面/Android：地址栏安装按钮或菜单“安装应用”。</p>
      </template>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const activeSection = ref('');
const reuse = ref(localStorage.getItem('wc:reuse-watermark') === '1');
const priority = ref(localStorage.getItem('wc:trans-priority') || 'local-free-llm');
const freeEnabled = ref(localStorage.getItem('wc:free-enabled') !== '0');
const dictRows = ref<{ zh: string; es: string }[]>([]);
const whitelist = ref<string[]>([]);
const newWord = ref('');
const freeUsed = ref(0);
const providers = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'] },
  { id: 'kimi', name: 'Kimi / Moonshot', baseURL: 'https://api.moonshot.cn/v1', models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'] },
  { id: 'glm', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5'] },
  { id: 'gpt', name: 'OpenAI GPT', baseURL: 'https://api.openai.com/v1', models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.6-cyber'] },
  { id: 'opencode', name: 'OpenCode Go', baseURL: 'https://opencode.ai/zen/go/v1', models: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'glm-5.3', 'gpt-5.6-luna', 'kimi-k3.1-pro', 'kimi-k3', 'minimax-m3', 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'] },
  { id: 'minimax', name: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', models: ['MiniMax-M3', 'MiniMax-M3.1'] },
  { id: 'qwen', name: '通义千问 Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus'] },
  { id: 'mimo', name: 'MiMo', baseURL: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'] },
  { id: 'custom', name: '自定义模型', baseURL: '', models: [] },
] as const;
const llmProvider = ref('deepseek');
const llmBase = ref('');
const llmModel = ref('deepseek-chat');
const llmModelCustom = ref('');
const modelOptions = ref<string[]>([]);
const modelsLoading = ref(false);
const llmKey = ref('');
const llmHasKey = ref(false);
const currentProvider = computed(() => providers.find((p) => p.id === llmProvider.value) ?? providers[providers.length - 1]);
const shares = ref<{ token: string; url: string; count: number; folderName?: string; createdAt: number; expiresAt: number }[]>([]);
const toast = ref('');
const location = window.location;
const me = ref<{ id: string; username: string; role: string } | null>(null);
const users = ref<{ id: string; username: string; role: string }[]>([]);
const oldPassword = ref('');
const newPassword = ref('');
const newUsername = ref('');
const newUserPassword = ref('');

const sections = [
  { id: 'translation', name: '翻译', icon: '🌐', desc: '词典 / 免费 / 大模型' },
  { id: 'reuse', name: '水印复用', icon: '🔁', desc: '拍完是否保留内容' },
  { id: 'shares', name: '分享链接', icon: '🔗', desc: '查看/撤回' },
  { id: 'account', name: '账户', icon: '👤', desc: '登录/退出' },
  { id: 'storage', name: '存储', icon: '💾', desc: '本地盘 / OSS' },
  { id: 'about', name: '关于', icon: 'ℹ️', desc: '支持与说明' },
];

function openSection(id: string) {
  activeSection.value = id;
  if (id === 'shares') void loadShares();
}
function todayKey() { return new Date().toISOString().slice(0, 10); }
function loadLocalConfig() {
  try {
    const pairs = JSON.parse(localStorage.getItem('wc:dict-pairs') || '[]');
    if (Array.isArray(pairs) && pairs.length) dictRows.value = pairs;
    else {
      const legacy = JSON.parse(localStorage.getItem('wc:dict') || '{}');
      dictRows.value = Object.entries(legacy).map(([zh, es]) => ({ zh, es: String(es) }));
    }
  } catch { dictRows.value = []; }
  if (!dictRows.value.length) dictRows.value = [{ zh: '', es: '' }];
  try {
    const words = JSON.parse(localStorage.getItem('wc:whitelist-phrases') || '[]');
    whitelist.value = Array.isArray(words) ? words : [];
  } catch { whitelist.value = []; }
  try {
    const usage = JSON.parse(localStorage.getItem('wc:free-usage') || '{}');
    freeUsed.value = usage.date === todayKey() ? Number(usage.chars) || 0 : 0;
  } catch { freeUsed.value = 0; }
}
async function loadLlm() {
  try {
    const l = await api<{ provider: string; baseURL: string; model: string; hasKey: boolean }>('/api/llm');
    if (l.provider) {
      llmProvider.value = l.provider;
      llmBase.value = l.baseURL || '';
      llmModel.value = l.model || currentProvider.value.models[0] || '__custom';
      llmHasKey.value = l.hasKey;
      modelOptions.value = [...new Set([l.model, ...currentProvider.value.models].filter(Boolean))] as string[];
    } else {
      modelOptions.value = [...currentProvider.value.models];
      llmModel.value = currentProvider.value.models[0] ?? '__custom';
    }
  } catch {
    modelOptions.value = [...currentProvider.value.models];
  }
}
function onProviderChange() {
  llmBase.value = currentProvider.value.baseURL;
  modelOptions.value = [...currentProvider.value.models];
  llmModel.value = currentProvider.value.models[0] ?? '__custom';
  llmModelCustom.value = '';
}
async function refreshModels() {
  const base = llmProvider.value === 'custom' ? llmBase.value.trim() : currentProvider.value.baseURL;
  if (!base) { toast.value = '请先填写 Base URL'; return; }
  modelsLoading.value = true;
  try {
    const res = await api<{ models: string[] }>('/api/llm/models', {
      method: 'POST',
      body: JSON.stringify({ baseURL: base, apiKey: llmKey.value || undefined }),
    });
    if (!res.models.length) { toast.value = '该厂商没有返回模型列表'; return; }
    modelOptions.value = res.models;
    if (!res.models.includes(llmModel.value)) llmModel.value = res.models[0]!;
    toast.value = `已获取 ${res.models.length} 个模型`;
  } catch (e: any) {
    toast.value = '获取模型失败：' + (e.message || '请检查 API Key');
  } finally {
    modelsLoading.value = false;
    setTimeout(() => { toast.value = ''; }, 3000);
  }
}
async function saveLlm() {
  const model = llmModel.value === '__custom' ? llmModelCustom.value.trim() : llmModel.value;
  if (!model) { toast.value = '请选择或填写模型名'; return; }
  const base = llmProvider.value === 'custom' ? llmBase.value.trim() : currentProvider.value.baseURL;
  if (!base) { toast.value = '请填写 Base URL'; return; }
  try {
    await api('/api/llm', {
      method: 'PUT',
      body: JSON.stringify({ provider: llmProvider.value, baseURL: base, model, apiKey: llmKey.value || undefined }),
    });
    llmKey.value = '';
    llmHasKey.value = true;
    toast.value = '大模型配置已保存';
    setTimeout(() => { toast.value = ''; }, 2000);
  } catch (e: any) { toast.value = '保存失败：' + (e.message || '未知'); }
}

function saveTranslation() {
  priority.value = priority.value || 'local-free-llm';
  localStorage.setItem('wc:trans-priority', priority.value);
  localStorage.setItem('wc:free-enabled', freeEnabled.value ? '1' : '0');
  const pairs = dictRows.value.filter((r) => r.zh.trim() && r.es.trim());
  localStorage.setItem('wc:dict-pairs', JSON.stringify(pairs));
  localStorage.setItem('wc:whitelist-phrases', JSON.stringify(whitelist.value));
  toast.value = '翻译设置已保存';
  setTimeout(() => { toast.value = ''; }, 2000);
}
function addWord() {
  const w = newWord.value.trim();
  if (!w) return;
  if (!whitelist.value.includes(w)) whitelist.value.push(w);
  newWord.value = '';
}
function saveReuse() { localStorage.setItem('wc:reuse-watermark', reuse.value ? '1' : '0'); }
async function loadMe() {
  try {
    const r = await api<{ id: string; user: string; role: string }>('/api/me');
    me.value = { id: r.id, username: r.user, role: r.role };
  } catch {}
  if (me.value?.role === 'admin') await loadUsers();
}
async function loadUsers() {
  try { users.value = (await api<{ users: typeof users.value }>('/api/users')).users; } catch {}
}
async function changePassword() {
  if (!oldPassword.value || !newPassword.value) { toast.value = '请填写旧密码和新密码'; return; }
  try {
    await api('/api/me/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPassword.value, newPassword: newPassword.value }) });
    oldPassword.value = ''; newPassword.value = '';
    toast.value = '密码已修改，请记住新密码';
  } catch (e: any) { toast.value = e.message || '修改失败'; }
  setTimeout(() => { toast.value = ''; }, 3000);
}
async function createUser() {
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: newUsername.value.trim(), password: newUserPassword.value }) });
    newUsername.value = ''; newUserPassword.value = '';
    await loadUsers();
    toast.value = '账号已创建';
  } catch (e: any) { toast.value = e.message || '创建失败'; }
  setTimeout(() => { toast.value = ''; }, 2500);
}
async function resetPassword(u: { id: string; username: string }) {
  const pwd = prompt(`给 ${u.username} 设置新密码（至少 6 位）`);
  if (!pwd) return;
  try { await api(`/api/users/${u.id}/password`, { method: 'POST', body: JSON.stringify({ password: pwd }) }); toast.value = '密码已重置'; }
  catch (e: any) { toast.value = e.message || '重置失败'; }
  setTimeout(() => { toast.value = ''; }, 2500);
}
async function deleteUser(u: { id: string; username: string }) {
  if (!confirm(`删除账号 ${u.username}？其照片不会自动删除。`)) return;
  try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); await loadUsers(); toast.value = '账号已删除'; }
  catch (e: any) { toast.value = e.message || '删除失败'; }
  setTimeout(() => { toast.value = ''; }, 2500);
}

async function loadShares() {
  try { const res = await api<{ shares: typeof shares.value }>('/api/shares'); shares.value = res.shares; } catch {}
}
async function revoke(token: string) {
  if (!confirm('撤回这个分享链接？客户将无法再打开。')) return;
  await api(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE' });
  toast.value = '已撤回';
  await loadShares();
  setTimeout(() => { toast.value = ''; }, 2000);
}
async function logout() {
  await api('/api/logout', { method: 'POST' });
  await router.replace('/login');
}
onMounted(() => { loadLocalConfig(); void loadLlm(); void loadMe(); });
</script>
