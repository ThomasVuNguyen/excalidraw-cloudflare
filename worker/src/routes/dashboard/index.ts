import { Hono } from 'hono';
import type { Env, AppVariables } from '../../types';
import drawingsRouter from './drawings';
import collectionsRouter from './collections';
import libraryRouter from './library';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.route('/drawings', drawingsRouter);
app.route('/collections', collectionsRouter);
app.route('/library', libraryRouter);

export default app;
