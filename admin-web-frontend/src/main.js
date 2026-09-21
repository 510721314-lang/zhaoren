import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIcons from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(ElementPlus);
app.use(router);
for (const [name, comp] of Object.entries(ElementPlusIcons)) {
  app.component(name, comp);
}
app.mount('#app');
