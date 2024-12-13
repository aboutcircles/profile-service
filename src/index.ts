import express, {Request, Response} from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import timeout from 'connect-timeout';
import {health} from "./httpApi/get/health";
import {pin} from "./httpApi/post/pin";
import {get} from "./httpApi/get/get";
import {getBatch} from "./httpApi/get/getBatch";
import {getConfig} from "./config";

const app = express();
const port = process.env.PINNING_SERVICE_PORT || 3000;

const config = getConfig();
const maxProfileSize = config.descriptionLength + config.imageUrlLength + config.maxNameLength + config.maxImageSizeKB * 1024;

app.use(cors({origin: config.corsOrigin, methods: ['GET', 'POST']}));
app.use(bodyParser.json({limit: `${maxProfileSize / 1024}kb`}));
app.use(timeout(`${config.defaultTimeout}ms`));

const haltOnTimedout = (req: Request, res: Response, next: () => void) => {
    if (!req.timedout) next();
};

app.get('/health', haltOnTimedout, health());
app.get('/getBatch', haltOnTimedout, getBatch());
app.get('/get', haltOnTimedout, get());

app.post('/pin', haltOnTimedout, pin());

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});
