<template>
  <div :class="['app', { 'app-camera': route.name === 'camera' }]">
    <header class="topbar">
      <router-link to="/" class="brand">外贸水印相机</router-link>
      <nav>
        <router-link to="/">拍照</router-link>
        <router-link to="/records">记录</router-link>
        <router-link to="/manager" class="desktop-only">管理</router-link>
        <router-link to="/settings">设置</router-link>
      </nav>
    </header>
    <main :class="['main', { 'main-camera': route.name === 'camera' }]">
      <router-view v-slot="{ Component }">
        <keep-alive include="CameraPage">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
</script>
