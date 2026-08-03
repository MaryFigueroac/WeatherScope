/**
 * @fileoverview WeatherScope v2.0.0
 * @author Mary Figueroa
 * @version 2.0.0
 * @license MIT
 * 
 * Aplicación moderna de clima en tiempo real con:
 * - Búsqueda de ciudades en tiempo real (Open-Meteo API)
 * - Caché inteligente en memoria (30 segundos)
 * - AbortController para timeout automático (10 segundos)
 * - Fallback a caché expirado en caso de error
 * - Tema oscuro/claro con preferencias guardadas
 * - Favoritos y historial persistentes
 * - Pronóstico de 7 días con detalles
 * - Logging y debugging integrado
 * - Sin dependencias externas (Vanilla JS)
 */

// ============================================================================
// CONFIGURACIÓN GLOBAL
// ============================================================================

/**
 * Configuración centralizada de la aplicación
 * Modifica estos valores para ajustar el comportamiento
 * 
 * @type {Object}
 * @constant
 */
const CONFIG = {
  // Tiempo de vida del caché en milisegundos
  CACHE_DURATION: 30 * 1000,      // 30 segundos

  // Timeout máximo para peticiones HTTP
  REQUEST_TIMEOUT: 10 * 1000,     // 10 segundos

  // Límites de almacenamiento
  MAX_FAVORITES: 8,               // Máximo de ciudades favoritas
  MAX_HISTORY: 10,                // Máximo de búsquedas en historial

  // Endpoints de API
  API_GEO: 'https://geocoding-api.open-meteo.com/v1/search',
  API_WEATHER: 'https://api.open-meteo.com/v1/forecast',

  // Logging
  DEBUG: true                      // Activar/desactivar logs
};

/**
 * Almacenamiento en caché en memoria
 * Estructura: Map<city, {timestamp, data}>
 * 
 * @type {Map<string, {timestamp: number, data: Object}>}
 */
const weatherCache = new Map();

// ============================================================================
// REFERENCIAS A ELEMENTOS DEL DOM
// ============================================================================

/** @type {HTMLInputElement} Campo de entrada de ciudad */
const cityInput = document.getElementById("cityInput");

/** @type {HTMLButtonElement} Botón de búsqueda */
const searchButton = document.getElementById("searchButton");

/** @type {HTMLDivElement} Contenedor de resultados de clima */
const weatherContainer = document.getElementById("weatherContainer");

/** @type {HTMLDivElement} Indicador de carga */
const loading = document.getElementById("loading");

/** @type {HTMLDivElement} Contenedor de mensajes de error */
const errorMessage = document.getElementById("errorMessage");

/** @type {HTMLSpanElement} Texto del error */
const errorText = document.getElementById("errorText");

/** @type {HTMLDivElement} Información del caché */
const cacheInfo = document.getElementById("cacheInfo");

/** @type {HTMLSpanElement} Texto de info del caché */
const cacheText = document.getElementById("cacheText");

/** @type {HTMLButtonElement} Botón de cambio de tema */
const themeToggle = document.getElementById("themeToggle");

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

/**
 * Inicializa todos los event listeners al cargar el DOM
 */
function initialize() {
  console.log("┌─ Weather App Pro v2.0.0 ─────────────────┐");
  console.log("│ Inicializando aplicación...               │");
  console.log("└──────────────────────────────────────────┘");

  // Búsqueda
  searchButton.addEventListener("click", search);
  cityInput.addEventListener("keydown", e => {
    if (e.key === "Enter") search();
  });

  // Tema
  themeToggle.addEventListener("click", toggleTheme);

  // Ciudades rápidas
  document.querySelectorAll(".quick-city").forEach(btn => {
    btn.addEventListener("click", () => {
      cityInput.value = btn.dataset.city;
      search();
    });
  });

  // Historial
  document.getElementById("clearHistory").addEventListener("click", () => {
    if (confirm("¿Estás seguro de que deseas borrar el historial?")) {
      localStorage.removeItem("history");
      renderHistory();
      console.log("[HISTORIAL] Borrado");
    }
  });

  // Cargar datos iniciales
  loadTheme();
  renderFavorites();
  renderHistory();

  console.log("[✓] Inicialización completada");
  console.log(`[CACHÉ] Configurado: ${CONFIG.CACHE_DURATION / 1000}s duración`);
}

// Ejecutar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", initialize);

// ============================================================================
// TEMA (OSCURO/CLARO)
// ============================================================================

/**
 * Cambia entre tema oscuro y claro
 * Almacena la preferencia en localStorage
 * 
 * @function
 * @returns {void}
 */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.dataset.theme === "dark";
  const newTheme = isDark ? "light" : "dark";

  html.dataset.theme = newTheme;
  themeToggle.textContent = isDark ? "🌙 Oscuro" : "☀️ Claro";
  localStorage.setItem("theme", newTheme);

  log("THEME", `Cambiado a: ${newTheme}`);
}

/**
 * Carga el tema guardado del usuario desde localStorage
 * Si no existe preferencia, usa "light" por defecto
 * 
 * @function
 * @returns {void}
 */
function loadTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.dataset.theme = savedTheme;
  themeToggle.textContent = savedTheme === "dark" ? "☀️ Claro" : "🌙 Oscuro";
  
  log("THEME", `Cargado: ${savedTheme}`);
}

// ============================================================================
// BÚSQUEDA Y CLIMA
// ============================================================================

/**
 * Maneja la búsqueda de ciudades
 * Soporta búsqueda múltiple (ciudades separadas por comas)
 * 
 * @async
 * @function
 * @returns {Promise<void>}
 * 
 * @example
 * // Búsqueda simple
 * search(); // Busca lo que está en cityInput
 * 
 * @example
 * // Búsqueda múltiple (desde input)
 * cityInput.value = "Madrid, Barcelona, París";
 * search();
 */
async function search() {
  const input = cityInput.value.trim();

  // Validación de entrada
  if (!input) {
    showError("Escribe una o varias ciudades");
    return;
  }

  if (input.length > 200) {
    showError("El texto es demasiado largo (máximo 200 caracteres)");
    return;
  }

  if (!/^[a-záéíóúñ,\s\-]+$/i.test(input)) {
    showError("Solo se permiten letras, comas y espacios");
    return;
  }

  // Limpiar UI
  hideError();
  weatherContainer.innerHTML = "";
  cacheInfo.classList.add("d-none");
  loading.classList.remove("d-none");

  // Parsear ciudades
  const cities = input.split(",")
    .map(c => c.trim())
    .filter(Boolean);

  log("BÚSQUEDA", `Iniciada para ${cities.length} ciudad(es)`);

  // Buscar cada ciudad
  for (const city of cities) {
    try {
      const data = await getWeather(city);

      renderWeather(data);
      addHistory(data.city);

      // Mostrar info de caché
      if (data.fromCache) {
        const age = Math.round((Date.now() - data.cacheTime) / 1000);
        const message = data.cacheExpired
          ? `⚠️ Datos desactualizados del caché (hace ${age}s)`
          : `⚡ Datos del caché (hace ${age}s)`;
        
        cacheText.textContent = message;
        cacheInfo.classList.remove("d-none");
        
        log("CACHÉ", `Usado para ${city} (edad: ${age}s)`);
      }

    } catch (err) {
      showError(`${err.message}`);
      log("ERROR", `${city}: ${err.message}`);
    }
  }

  loading.classList.add("d-none");
  log("BÚSQUEDA", "Completada");
}

/**
 * Obtiene datos meteorológicos de una ciudad
 * 
 * Implementa:
 * - Caché en memoria (30 segundos)
 * - AbortController para timeout (10 segundos)
 * - Fallback a caché expirado si falla la API
 * - Manejo clasificado de errores
 * 
 * @async
 * @function
 * @param {string} city - Nombre de la ciudad
 * @returns {Promise<Object>} Objeto con datos del clima:
 *   - city {string} Nombre de la ciudad
 *   - country {string} País
 *   - current {Object} Datos actuales (temperatura, humedad, etc.)
 *   - daily {Object} Pronóstico diario
 *   - fromCache {boolean} Si proviene del caché
 *   - cacheTime {number} Timestamp del caché
 *   - cacheExpired {boolean} Si los datos están expirados
 * 
 * @throws {Error} Si la ciudad no existe o la API falla
 * 
 * @example
 * const weather = await getWeather('Madrid');
 * console.log(`${weather.city}: ${weather.current.temperature_2m}°C`);
 */
async function getWeather(city) {
  const key = city.toLowerCase();
  const cached = weatherCache.get(key);
  const now = Date.now();

  // Verificar caché vigente
  if (cached && (now - cached.timestamp < CONFIG.CACHE_DURATION)) {
    log("CACHÉ", `Usando datos en caché para: ${city}`);
    return {
      ...cached.data,
      fromCache: true,
      cacheTime: cached.timestamp,
      cacheExpired: false
    };
  }

  // Configurar AbortController para timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    log("TIMEOUT", `Abortando solicitud para: ${city}`);
    controller.abort();
  }, CONFIG.REQUEST_TIMEOUT);

  const startTime = Date.now();

  try {
    log("API", `Buscando ciudad: ${city}`);

    // PASO 1: Obtener coordenadas
    const geoRes = await fetch(
      `${CONFIG.API_GEO}?name=${encodeURIComponent(city)}&count=1&language=es&format=json`,
      { signal: controller.signal }
    );

    if (!geoRes.ok) {
      throw new Error(`API Geocoding falló: HTTP ${geoRes.status}`);
    }

    const geoData = await geoRes.json();

    if (!geoData.results?.length) {
      throw new Error(`"${city}" no encontrada. Verifica el nombre.`);
    }

    const loc = geoData.results[0];
    log("GEO", `${loc.name}, ${loc.country} encontrada (${loc.latitude}, ${loc.longitude})`);

    // PASO 2: Obtener datos meteorológicos
    const weatherRes = await fetch(
      `${CONFIG.API_WEATHER}?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,visibility,cloud_cover,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`,
      { signal: controller.signal }
    );

    if (!weatherRes.ok) {
      throw new Error(`API Clima falló: HTTP ${weatherRes.status}`);
    }

    const weather = await weatherRes.json();

    // Construir resultado
    const result = {
      city: loc.name,
      country: loc.country,
      lat: loc.latitude,
      lon: loc.longitude,
      current: weather.current,
      daily: weather.daily,
      fromCache: false
    };

    // Guardar en caché
    weatherCache.set(key, {
      timestamp: now,
      data: result
    });

    const duration = Date.now() - startTime;
    log("API", `✓ Completada en ${duration}ms (${weatherCache.size} en caché)`);

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    log("ERROR", `${city} (${duration}ms): ${error.message}`);

    // FALLBACK: Usar caché expirado
    if (cached) {
      log("FALLBACK", `Usando caché expirado para: ${city} (${Math.round((now - cached.timestamp) / 1000)}s viejo)`);
      return {
        ...cached.data,
        fromCache: true,
        cacheTime: cached.timestamp,
        cacheExpired: true
      };
    }

    // Clasificar error
    if (error.name === "AbortError") {
      throw new Error(`⏱️ Timeout: La solicitud tardó más de ${CONFIG.REQUEST_TIMEOUT / 1000}s`);
    }

    if (error instanceof TypeError) {
      throw new Error("🌐 Error de conexión. Verifica tu internet.");
    }

    if (!navigator.onLine) {
      throw new Error("📡 Sin conexión a internet");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// INFORMACIÓN DE CLIMA
// ============================================================================

/**
 * Clasifica el estado del clima según códigos WMO, cobertura de nubes y precipitación
 * 
 * Basado en:
 * - Códigos WMO (World Meteorological Organization)
 * - Cobertura de nubes (0-100%)
 * - Precipitación en mm
 * 
 * @function
 * @param {number} [code=0] - Código de clima WMO
 * @param {number} [cloud=0] - Cobertura de nubes (0-100)
 * @param {number} [precipitation=0] - Precipitación en mm
 * @returns {Object} {icon: string, text: string}
 * 
 * @example
 * const info = getWeatherInfo(0, 20, 0);
 * console.log(info); // { icon: '☀️', text: 'Soleado' }
 * 
 * @example
 * const info = getWeatherInfo(61, 80, 2.5);
 * console.log(info); // { icon: '🌧️', text: 'Lluvia ligera' }
 */
function getWeatherInfo(code = 0, cloud = 0, precipitation = 0) {
  // Sin lluvia: clasificar por cobertura de nubes
  if (precipitation < 0.1) {
    if (cloud <= 10) return { icon: "☀️", text: "Soleado" };
    if (cloud <= 30) return { icon: "🌤️", text: "Mayormente soleado" };
    if (cloud <= 60) return { icon: "⛅", text: "Parcialmente nublado" };
    if (cloud <= 90) return { icon: "☁️", text: "Nublado" };
    return { icon: "☁️", text: "Muy nublado" };
  }

  // Con lluvia: clasificar por cantidad
  if (precipitation < 0.5) return { icon: "🌦️", text: "Llovizna ligera" };
  if (precipitation < 2) return { icon: "🌧️", text: "Lluvia ligera" };
  if (precipitation < 5) return { icon: "🌧️", text: "Lluvia moderada" };
  if (precipitation < 10) return { icon: "🌧️", text: "Lluvia fuerte" };
  return { icon: "⛈️", text: "Tormenta severa" };
}

// ============================================================================
// RENDERIZADO
// ============================================================================

/**
 * Renderiza una tarjeta de clima en el DOM
 * Muestra información actual y pronóstico de 7 días
 * 
 * @function
 * @param {Object} data - Datos del clima
 * @param {string} data.city - Nombre de la ciudad
 * @param {string} data.country - País
 * @param {number} data.lat - Latitud
 * @param {number} data.lon - Longitud
 * @param {Object} data.current - Datos actuales
 * @param {number} data.current.temperature_2m - Temperatura en °C
 * @param {number} data.current.apparent_temperature - Sensación térmica
 * @param {number} data.current.relative_humidity_2m - Humedad (%)
 * @param {number} data.current.wind_speed_10m - Velocidad del viento
 * @param {number} data.current.wind_gusts_10m - Ráfagas de viento
 * @param {number} data.current.precipitation - Precipitación
 * @param {number} data.current.visibility - Visibilidad
 * @param {number} data.current.cloud_cover - Cobertura de nubes
 * @param {Object} data.daily - Datos diarios
 * @param {Array} data.daily.time - Fechas
 * @param {Array} data.daily.weather_code - Códigos de clima
 * @param {Array} data.daily.temperature_2m_max - Temperaturas máximas
 * @param {Array} data.daily.temperature_2m_min - Temperaturas mínimas
 * @param {Array} data.daily.precipitation_probability_max - Probabilidad lluvia
 * @param {boolean} data.fromCache - Si proviene del caché
 * @param {boolean} [data.cacheExpired=false] - Si el caché está expirado
 * @returns {void}
 */
function renderWeather(data) {
  const c = data.current;

  // Obtener información del clima
  const info = getWeatherInfo(
    c.weather_code,
    c.cloud_cover,
    c.precipitation
  );

  // Construir HTML
  const html = `
    <div class="weather-card">

      <!-- ENCABEZADO CON CIUDAD Y TEMPERATURA -->
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-4">

        <div>
          <h2 class="mb-1">${data.city}</h2>
          <p class="text-muted mb-0">${data.country}</p>

          <div class="condition">
            ${info.icon} ${info.text}
          </div>

          ${data.fromCache ? `<div class="cache-badge mt-3">
            ⚡ ${data.cacheExpired ? '⚠️ Datos desactualizados del caché' : 'Desde caché'}
          </div>` : ''}
        </div>

        <div class="text-end">
          <div class="weather-icon">${info.icon}</div>
          <div class="temp">${format(c.temperature_2m)} °C</div>
          <div class="text-muted">${format(toF(c.temperature_2m))} °F</div>
        </div>

      </div>

      <!-- MÉTRICAS PRINCIPALES -->
      <div class="row g-3 mt-4">
        ${metric("🤗 Sensación", `${format(c.apparent_temperature)} °C`)}
        ${metric("💧 Humedad", `${format(c.relative_humidity_2m)} %`)}
        ${metric("🌬️ Viento", `${format(c.wind_speed_10m)} km/h`)}
        ${metric("💨 Ráfagas", `${format(c.wind_gusts_10m)} km/h`)}
        ${metric("🌧️ Precipitación", `${format(c.precipitation)} mm`)}
        ${metric("👁️ Visibilidad", `${format(c.visibility / 1000)} km`)}
        ${metric("☁️ Nubes", `${format(c.cloud_cover)} %`)}
        ${metric("📍 Ubicación", `${format(data.lat)}, ${format(data.lon)}`)}
      </div>

      <!-- BOTÓN FAVORITO -->
      <div class="d-flex justify-content-end mt-4">
        <button class="btn btn-outline-warning btn-sm" onclick="addFavorite('${data.city}')">
          ⭐ Guardar favorito
        </button>
      </div>

      <!-- PRONÓSTICO DE 7 DÍAS -->
      <h5 class="mt-4 mb-3">📅 Pronóstico de 7 días</h5>

      <div class="row g-3">
        ${data.daily.time.slice(0, 7).map((d, i) => {
          const dayInfo = getWeatherInfo(
            data.daily.weather_code[i],
            50,
            data.daily.precipitation_probability_max[i] > 40 ? 1 : 0
          );

          const date = new Date(d);
          const dayName = date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });

          return `
            <div class="col-6 col-md-4 col-lg">
              <div class="forecast-day">
                <div class="fw-semibold">${dayName}</div>
                <div class="forecast-icon">${dayInfo.icon}</div>
                <div class="small fw-semibold mb-2">${dayInfo.text}</div>
                <div class="forecast-temp">${format(data.daily.temperature_2m_max[i])}°</div>
                <div class="forecast-min">${format(data.daily.temperature_2m_min[i])}°</div>
                <div class="small text-muted mt-2">
                  🌧️ ${data.daily.precipitation_probability_max[i]}%
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>

    </div>
  `;

  weatherContainer.innerHTML += html;
}

/**
 * Crea una métrica para mostrar en la tarjeta de clima
 * 
 * @function
 * @param {string} label - Etiqueta de la métrica (ej: "🤗 Sensación")
 * @param {string} value - Valor a mostrar (ej: "22,5 °C")
 * @returns {string} HTML de la métrica
 */
function metric(label, value) {
  return `
    <div class="col-6 col-md-3">
      <div class="metric">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
      </div>
    </div>
  `;
}

// ============================================================================
// FAVORITOS
// ============================================================================

/**
 * Agrega una ciudad a la lista de favoritos
 * Almacena en localStorage, máximo 8 ciudades (FIFO)
 * 
 * @function
 * @param {string} city - Nombre de la ciudad
 * @returns {void}
 * 
 * @example
 * addFavorite('Madrid');
 */
function addFavorite(city) {
  let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");

  if (!favorites.includes(city)) {
    favorites.unshift(city);
    localStorage.setItem(
      "favorites",
      JSON.stringify(favorites.slice(0, CONFIG.MAX_FAVORITES))
    );

    renderFavorites();
    log("FAVORITOS", `Agregada: ${city}`);
  } else {
    log("FAVORITOS", `Ya existe: ${city}`);
  }
}

/**
 * Renderiza la lista de ciudades favoritas en el DOM
 * 
 * @function
 * @returns {void}
 */
function renderFavorites() {
  const list = document.getElementById("favoritesList");
  const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");

  if (favorites.length === 0) {
    list.innerHTML = '<div class="empty">No hay favoritos. ¡Agrega ciudades!</div>';
    return;
  }

  list.innerHTML = favorites.map(city => `
    <button class="list-item" onclick="searchCity('${city}')">
      ⭐ ${city}
    </button>
  `).join("");
}

// ============================================================================
// HISTORIAL
// ============================================================================

/**
 * Agrega una ciudad al historial de búsquedas
 * Máximo 10 búsquedas, sin duplicados (se mueve al inicio)
 * Almacena en localStorage
 * 
 * @function
 * @param {string} city - Nombre de la ciudad
 * @returns {void}
 * 
 * @example
 * addHistory('Madrid');
 */
function addHistory(city) {
  let history = JSON.parse(localStorage.getItem("history") || "[]");

  // Eliminar duplicados y agregar al inicio
  history = [city, ...history.filter(c => c !== city)].slice(0, CONFIG.MAX_HISTORY);

  localStorage.setItem("history", JSON.stringify(history));
  renderHistory();

  log("HISTORIAL", `Agregada: ${city}`);
}

/**
 * Renderiza el historial de búsquedas en el DOM
 * 
 * @function
 * @returns {void}
 */
function renderHistory() {
  const list = document.getElementById("historyList");
  const history = JSON.parse(localStorage.getItem("history") || "[]");

  if (history.length === 0) {
    list.innerHTML = '<div class="empty">Sin búsquedas anteriores.</div>';
    return;
  }

  list.innerHTML = history.map(city => `
    <button class="list-item" onclick="searchCity('${city}')">
      🕘 ${city}
    </button>
  `).join("");
}

// ============================================================================
// UTILIDADES
// ============================================================================

/**
 * Busca una ciudad por nombre
 * Establece el valor en el input y ejecuta la búsqueda
 * 
 * @function
 * @param {string} city - Nombre de la ciudad
 * @returns {void}
 * 
 * @example
 * searchCity('Madrid');
 */
function searchCity(city) {
  cityInput.value = city;
  search();
}

/**
 * Formatea un número a 1 decimal con coma (formato europeo)
 * 
 * @function
 * @param {number} v - Valor numérico
 * @returns {string} Valor formateado (ej: "22,5")
 * 
 * @example
 * format(22.456) // Returns: "22,5"
 */
function format(v) {
  return Number(v).toFixed(1).replace(".", ",");
}

/**
 * Convierte grados Celsius a Fahrenheit
 * 
 * @function
 * @param {number} c - Grados Celsius
 * @returns {number} Grados Fahrenheit
 * 
 * @example
 * toF(0)   // Returns: 32
 * toF(100) // Returns: 212
 */
function toF(c) {
  return c * 9 / 5 + 32;
}

// ============================================================================
// MENSAJES Y ALERTAS
// ============================================================================

/**
 * Muestra un mensaje de error en la UI
 * 
 * @function
 * @param {string} msg - Mensaje de error a mostrar
 * @returns {void}
 * 
 * @example
 * showError('Ciudad no encontrada');
 */
function showError(msg) {
  errorText.textContent = msg;
  errorMessage.classList.remove("d-none");
  log("ERROR_UI", msg);
}

/**
 * Oculta el mensaje de error
 * 
 * @function
 * @returns {void}
 */
function hideError() {
  errorMessage.classList.add("d-none");
}

// ============================================================================
// DEBUGGING Y LOGGING
// ============================================================================

/**
 * Sistema de logging centralizado
 * Registra eventos en la consola del navegador
 * 
 * @function
 * @param {string} category - Categoría del log (ej: "API", "CACHÉ", "ERROR")
 * @param {string} message - Mensaje a registrar
 * @returns {void}
 * 
 * @example
 * log("API", "Solicitud completada en 234ms");
 * log("CACHÉ", "Guardado: madrid");
 */
function log(category, message) {
  if (!CONFIG.DEBUG) return;

  const timestamp = new Date().toLocaleTimeString("es-ES");
  const colors = {
    API: "color: #3b82f6; font-weight: bold;",
    CACHÉ: "color: #10b981; font-weight: bold;",
    BÚSQUEDA: "color: #8b5cf6; font-weight: bold;",
    TIMEOUT: "color: #ef4444; font-weight: bold;",
    ERROR: "color: #dc2626; font-weight: bold;",
    GEO: "color: #f59e0b; font-weight: bold;",
    HISTORIAL: "color: #06b6d4; font-weight: bold;",
    FAVORITOS: "color: #ec4899; font-weight: bold;",
    THEME: "color: #8b5cf6; font-weight: bold;",
    FALLBACK: "color: #f97316; font-weight: bold;",
    ERROR_UI: "color: #dc2626; font-weight: bold;"
  };

  const style = colors[category] || "color: #6b7280; font-weight: bold;";
  console.log(`%c[${timestamp}] ${category}%c ${message}`, style, "color: inherit;");
}

/**
 * Obtiene estadísticas del caché actual
 * Útil para debugging en consola
 * 
 * @function
 * @returns {Object} Información del estado del caché:
 *   - size {number} Cantidad de ciudades en caché
 *   - items {Array} Lista de ciudades cachadas con detalles
 *   - nextCleanup {string} Tiempo hasta la próxima limpieza
 * 
 * @example
 * console.log(getCacheStats());
 * // Output:
 * // {
 * //   size: 3,
 * //   items: [
 * //     { city: 'madrid', age: '12s', isValid: true },
 * //     { city: 'barcelona', age: '25s', isValid: false },
 * //   ],
 * //   nextCleanup: '30s'
 * // }
 */
function getCacheStats() {
  const entries = Array.from(weatherCache.entries());
  const now = Date.now();

  const stats = {
    size: weatherCache.size,
    maxSize: CONFIG.CACHE_DURATION / 1000,
    items: entries.map(([key, value]) => ({
      city: key,
      age: Math.round((now - value.timestamp) / 1000) + "s",
      isValid: (now - value.timestamp) < CONFIG.CACHE_DURATION,
      data: {
        temperature: value.data.current.temperature_2m + "°C",
        city: value.data.city
      }
    })),
    timestamp: new Date().toLocaleTimeString("es-ES")
  };

  return stats;
}

/**
 * Muestra estadísticas del caché en una alerta
 * Función de utilidad para debugging en UI
 * 
 * @function
 * @returns {void}
 * 
 * @example
 * showCacheStats(); // Muestra stats en alerta
 */
function showCacheStats() {
  const stats = getCacheStats();
  const message = `
Estadísticas del Caché:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Total en caché: ${stats.size}
⏱️ Duración: ${stats.maxSize}s
🕐 Actualizado: ${stats.timestamp}

Ciudades:
${stats.items.map((item, i) => 
  `${i + 1}. ${item.city} (${item.age}) ${item.isValid ? '✓' : '⚠️'}`
).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `;
  
  alert(message);
  console.table(stats.items);
}

// Exponer función de debugging globalmente
window.getCacheStats = getCacheStats;
window.showCacheStats = showCacheStats;

log("APP", "Funciones de debugging disponibles: getCacheStats(), showCacheStats()");
