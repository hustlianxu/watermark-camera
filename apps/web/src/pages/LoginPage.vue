<template>
  <div class="card" style="margin-top: 12vh">
    <h2 style="margin-top:0">外贸水印相机</h2>
    <p class="hint">使用账号登录。管理员可在“设置 → 账户”里创建员工账号。</p>
    <form @submit.prevent="submit">
      <label>用户名</label>
      <input v-model="username" class="input" autocomplete="username" required />
      <label>密码</label>
      <input v-model="password" class="input" type="password" autocomplete="current-password" required />
      <p v-if="error" style="color:#dc2626;font-size:13px">{{ error }}</p>
      <button class="btn" style="width:100%;margin-top:14px" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';

const username = ref('admin');
const password = ref('');
const loading = ref(false);
const error = ref('');
const route = useRoute();
const router = useRouter();

async function submit() {
  loading.value = true; error.value = '';
  try {
    let passwordEnc: string | undefined;
    try {
      const pk = await api<{ key: JsonWebKey }>('/api/auth/public-key');
      const key = await crypto.subtle.importKey('jwk', pk.key, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(password.value));
      passwordEnc = btoa(String.fromCharCode(...new Uint8Array(enc)));
    } catch {}
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(passwordEnc
        ? { username: username.value.trim(), passwordEnc }
        : { username: username.value.trim(), password: password.value }),
    });
    const next = typeof route.query.next === 'string' ? route.query.next : '/';
    await router.replace(next);
  } catch (e: any) {
    error.value = e.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>
