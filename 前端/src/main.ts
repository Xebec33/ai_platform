import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import './styles.css';

createApp(App).use(createPinia()).mount('#app');
