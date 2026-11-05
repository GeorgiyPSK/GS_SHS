/* ============================================================
   Визуальный редактор сценариев (Drawflow)
   ============================================================ */

   let editor = null;

   function initVisualEditor() {
    if (editor) return;
    
    const id = document.getElementById('drawflow');
    if (!id) return;
  
    editor = new Drawflow(id);
    editor.reroute = true;
    editor.start();
  
    // --- Блок: Событие (Триггер) ---
    editor.addNode('trigger', 0, 1, 100, 100, 'trigger', {}, 
      `<div><b>⚡ Событие</b></div>
       <select class="df-select" df-trigger-type>
         <option value="device">Устройство изменилось</option>
         <option value="timer">Таймер</option>
       </select>
       <input type="text" class="df-input" df-trigger-device placeholder="ID устройства">
       <input type="text" class="df-input" df-trigger-field placeholder="Поле">`
    );
  
    // --- Блок: Условие ---
    editor.addNode('condition', 1, 1, 350, 100, 'condition', {},
      `<div><b>❓ Условие</b></div>
       <input type="text" class="df-input" df-cond-device placeholder="ID устройства">
       <input type="text" class="df-input" df-cond-field placeholder="Поле">
       <select class="df-select" df-cond-op>
         <option value="==">==</option>
         <option value=">">&gt;</option>
         <option value="<">&lt;</option>
       </select>
       <input type="text" class="df-input" df-cond-value placeholder="Значение">`
    );
  
    // --- Блок: Действие ---
    editor.addNode('action', 1, 0, 600, 100, 'action', {},
      `<div><b>⚙️ Действие</b></div>
       <select class="df-select" df-act-type>
         <option value="set_state">Установить состояние</option>
         <option value="notify">Уведомление</option>
         <option value="delay">Задержка (сек)</option>
       </select>
       <input type="text" class="df-input" df-act-device placeholder="ID устройства">
       <input type="text" class="df-input" df-act-field placeholder="Поле">
       <input type="text" class="df-input" df-act-value placeholder="Значение">`
    );
  }
   
   /* ============================================================
      Сохранение: Конвертация графа в JSON + сохранение visual_data
      ============================================================ */
      async function saveVisualScenario() {
        if (!editor) return;
      
        // 1. Экспортируем граф (чтобы получить структуру связей и ID нод)
        const graphData = editor.export();
        const nodes = graphData.drawflow.Home.data;
      
        // 2. Собираем условия и действия, проходя по цепочке
        // Ищем корневые узлы (триггеры) — те, у которых нет входов
        const triggers = Object.keys(nodes).filter(id => {
          const node = nodes[id];
          return node.name === 'trigger' || (node.inputs && Object.keys(node.inputs).length === 0);
        });
      
        if (triggers.length === 0) {
          alert('Добавьте хотя бы один блок "Событие" (Триггер)');
          return;
        }
      
        const rootId = triggers[0];
        const collectedConditions = [];
        const collectedActions = [];
        
        // Очередь для обхода (BFS)
        const queue = [rootId];
        const visited = new Set();
      
        while (queue.length > 0) {
          const id = queue.shift();
          if (visited.has(id)) continue;
          visited.add(id);
      
          const node = nodes[id];
          if (!node) continue;
      
          // 👇 ВАЖНО: читаем значения напрямую из DOM, а не из node.data
          const el = document.querySelector(`.drawflow-node[data-id="${id}"]`);
          if (!el) continue;
      
          if (node.name === 'condition') {
            const dev = el.querySelector('[df-cond-device]')?.value?.trim();
            const field = el.querySelector('[df-cond-field]')?.value?.trim();
            const op = el.querySelector('[df-cond-op]')?.value || '==';
            const val = el.querySelector('[df-cond-value]')?.value?.trim();
            
            if (dev && field) {
              collectedConditions.push({ 
                device: dev, 
                field: field, 
                op: op, 
                value: val, 
                negate: false 
              });
            }
          } 
          else if (node.name === 'action') {
            const type = el.querySelector('[df-act-type]')?.value || 'set_state';
            
            if (type === 'set_state') {
              const dev = el.querySelector('[df-act-device]')?.value?.trim();
              const field = el.querySelector('[df-act-field]')?.value?.trim();
              const val = el.querySelector('[df-act-value]')?.value?.trim();
              if (dev && field) {
                collectedActions.push({ 
                  type: 'set_state', 
                  device: dev, 
                  field: field, 
                  value: val, 
                  value_source: { mode: 'const' } 
                });
              }
            } else if (type === 'notify') {
              const title = el.querySelector('[df-act-device]')?.value?.trim() || 'Уведомление';
              const body = el.querySelector('[df-act-field]')?.value?.trim() || '';
              collectedActions.push({ 
                type: 'notify', 
                title: title, 
                body: body, 
                level: 'info' 
              });
            } else if (type === 'delay') {
              const sec = parseFloat(el.querySelector('[df-act-value]')?.value || '0');
              collectedActions.push({ 
                type: 'delay', 
                seconds: sec 
              });
            }
          }
      
          // Переход к следующим узлам
          if (node.outputs) {
            for (const outputKey in node.outputs) {
              const connections = node.outputs[outputKey].connections || [];
              for (const conn of connections) {
                queue.push(conn.node);
              }
            }
          }
        }
      
        // 3. Формируем итоговый сценарий
        const scenarioName = prompt('Название сценария:', 'Визуальный сценарий');
        if (!scenarioName) return;
      
        // Также сохраняем значения в visual_data для будущего восстановления
        // (чтобы при загрузке графа поля были заполнены)
        for (const id in nodes) {
          const node = nodes[id];
          const el = document.querySelector(`.drawflow-node[data-id="${id}"]`);
          if (!el) continue;
      
          if (node.name === 'trigger') {
            node.data.type = el.querySelector('[df-trigger-type]')?.value || 'device';
            node.data.device = el.querySelector('[df-trigger-device]')?.value || '';
            node.data.field = el.querySelector('[df-trigger-field]')?.value || '';
          } else if (node.name === 'condition') {
            node.data.device = el.querySelector('[df-cond-device]')?.value || '';
            node.data.field = el.querySelector('[df-cond-field]')?.value || '';
            node.data.op = el.querySelector('[df-cond-op]')?.value || '==';
            node.data.value = el.querySelector('[df-cond-value]')?.value || '';
          } else if (node.name === 'action') {
            node.data.act_type = el.querySelector('[df-act-type]')?.value || 'set_state';
            node.data.device = el.querySelector('[df-act-device]')?.value || '';
            node.data.field = el.querySelector('[df-act-field]')?.value || '';
            node.data.value = el.querySelector('[df-act-value]')?.value || '';
          }
        }
      
        const payload = {
          name: scenarioName,
          enabled: true,
          logic: "AND",
          initial_delay: 0,
          conditions: collectedConditions,
          actions: collectedActions,
          group: "",
          visual_data: graphData
        };
      
        try {
          let sid = window._visualCurrentScenarioId;
          let url = '/api/scenarios';
          let method = 'POST';
      
          if (sid) {
            url += '/' + sid;
          }
      
          const res = await api(url, method, payload);
          
          if (!sid && res.id) {
            window._visualCurrentScenarioId = res.id;
          }
      
          alert(`Сценарий сохранен! Условий: ${collectedConditions.length}, Действий: ${collectedActions.length}`);
          
          if (window.scenariosCache) {
            const idx = window.scenariosCache.findIndex(s => s.id === (sid || res.id));
            if (idx >= 0) {
              window.scenariosCache[idx] = res;
            } else {
              window.scenariosCache.push(res);
            }
          }
          
          if (typeof loadScenariosToVisualSelect === 'function') {
            loadScenariosToVisualSelect();
          }
      
        } catch (e) {
          alert('Ошибка сохранения: ' + e.message);
        }
      }
   
   /* ============================================================
      Загрузка: Восстановление графа из visual_data
      ============================================================ */
   async function loadScenarioToVisual(scenarioId) {
     if (!scenarioId || !editor) return;
   
     // 1. Если кэш пуст, загружаем сценарии с сервера
     if (!window.scenariosCache || window.scenariosCache.length === 0) {
       try {
         const list = await api('/api/scenarios');
         window.scenariosCache = list || [];
       } catch (e) {
         console.warn('[visual] load scenarios error:', e);
         alert('Не удалось загрузить сценарии с сервера');
         return;
       }
     }
   
     const list = window.scenariosCache || [];
     const sc = list.find(s => s.id === scenarioId);
     
     if (!sc) {
       alert('Сценарий не найден');
       return;
     }
   
     if (!sc.visual_data) {
       alert('Этот сценарий был создан вручную (без графа). Визуализация недоступна.');
       return;
     }
   
     // 2. Восстанавливаем граф
     editor.clear();
     editor.import(sc.visual_data);
     
     // 3. Восстанавливаем значения в инпутах
     const nodes = sc.visual_data.drawflow.Home.data;
     for (const id in nodes) {
       const node = nodes[id];
       const el = document.querySelector(`.drawflow-node[data-id="${id}"]`);
    console.log(`[visual] Node ${id} (${nodes[id].name}):`, el ? el.innerHTML : 'НЕ НАЙДЕН');
       if (!el) continue;
   
       if (node.name === 'trigger') {
         if (node.data.device) el.querySelector('[df-trigger-device]').value = node.data.device;
         if (node.data.field) el.querySelector('[df-trigger-field]').value = node.data.field;
         if (node.data.type) el.querySelector('[df-trigger-type]').value = node.data.type;
       } else if (node.name === 'condition') {
         if (node.data.device) el.querySelector('[df-cond-device]').value = node.data.device;
         if (node.data.field) el.querySelector('[df-cond-field]').value = node.data.field;
         if (node.data.op) el.querySelector('[df-cond-op]').value = node.data.op;
         if (node.data.value) el.querySelector('[df-cond-value]').value = node.data.value;
       } else if (node.name === 'action') {
         if (node.data.act_type) el.querySelector('[df-act-type]').value = node.data.act_type;
         if (node.data.device) el.querySelector('[df-act-device]').value = node.data.device;
         if (node.data.field) el.querySelector('[df-act-field]').value = node.data.field;
         if (node.data.value) el.querySelector('[df-act-value]').value = node.data.value;
       }
     }
   
     // 4. Запоминаем ID для последующего сохранения
     window._visualCurrentScenarioId = scenarioId;
   }
   
   /* ============================================================
      Заполнение выпадающего списка сценариями
      ============================================================ */
   async function loadScenariosToVisualSelect() {
     const sel = document.getElementById('visual-load-scenario');
     if (!sel) return;
   
     // Если кэш пуст, загружаем с сервера
     if (!window.scenariosCache || window.scenariosCache.length === 0) {
       try {
         const list = await api('/api/scenarios');
         window.scenariosCache = list || [];
       } catch (e) {
         console.warn('[visual] load scenarios error:', e);
         sel.innerHTML = '<option value="">— ошибка загрузки —</option>';
         return;
       }
     }
   
     const list = window.scenariosCache || [];
     sel.innerHTML = '<option value="">— загрузить существующий —</option>' +
       list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
   }
   
   /* ============================================================
      Очистка холста
      ============================================================ */
   function clearVisualCanvas() {
     if (!editor) return;
     editor.clear();
     initVisualEditor(); // Пересоздаем базовые ноды
   }