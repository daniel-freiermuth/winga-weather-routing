// SignalK Weather Routing plugin — serves the webapp.

interface SignalKApp {
  debug: (...args: unknown[]) => void;
  setPluginStatus: (msg: string) => void;
  setPluginError: (msg: string) => void;
  getPath: (p: string) => string | undefined;
}

interface Router {
  use: (path: string, ...handlers: unknown[]) => void;
}

interface Plugin {
  id: string;
  name: string;
  description: string;
  schema: () => object;
  start: (config: unknown) => void;
  stop: () => void;
  getOpenApi?: () => object;
  registerWithRouter?: (router: Router) => void;
}

module.exports = (app: SignalKApp): Plugin => {
  return {
    id: 'winga-weather-routing',
    name: 'Weather Routing',
    description: 'Weather routing plugin for Signal K using GRIB2 forecasts and isochrone algorithm.',

    schema: () => ({
      type: 'object',
      properties: {},
    }),

    start: () => {
      app.setPluginStatus('Running');
      app.debug('Weather routing plugin started');
    },

    stop: () => {
      app.debug('Weather routing plugin stopped');
    },
  };
};
