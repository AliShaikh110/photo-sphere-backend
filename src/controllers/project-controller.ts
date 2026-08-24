import type { Request, Response } from 'express';
import {
  createHotspot,
  createProject,
  createScene,
  deleteHotspot,
  deleteScene,
  getScene,
  listProjects,
  listScenes,
  readProject,
  updateHotspot,
  updateProject,
  updateScene
} from '../services/project-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function ownerId(request: Request): string {
  return request.auth!.userId;
}

export async function list(request: Request, response: Response): Promise<void> {
  sendData(response, { projects: await listProjects(ownerId(request)) });
}

export async function create(request: Request, response: Response): Promise<void> {
  const project = await createProject(ownerId(request), request.body);
  sendData(response, { project }, { status: 201, message: 'Project created.' });
}

export async function read(request: Request, response: Response): Promise<void> {
  const project = await readProject(routeParam(request, 'projectId'), ownerId(request));
  sendData(response, { project });
}

export async function update(request: Request, response: Response): Promise<void> {
  const project = await updateProject(routeParam(request, 'projectId'), ownerId(request), request.body);
  sendData(response, { project }, { message: 'Project saved.' });
}

export async function scenes(request: Request, response: Response): Promise<void> {
  sendData(response, { scenes: await listScenes(routeParam(request, 'projectId'), ownerId(request)) });
}

export async function readScene(request: Request, response: Response): Promise<void> {
  const scene = await getScene(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    ownerId(request)
  );
  sendData(response, { scene });
}

export async function addScene(request: Request, response: Response): Promise<void> {
  const result = await createScene(routeParam(request, 'projectId'), ownerId(request), request.body);
  sendData(response, result, { status: 201, message: 'Scene created.' });
}

export async function patchScene(request: Request, response: Response): Promise<void> {
  const result = await updateScene(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    ownerId(request),
    request.body
  );
  sendData(response, result, { message: 'Scene saved.' });
}

export async function removeScene(request: Request, response: Response): Promise<void> {
  const result = await deleteScene(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    ownerId(request),
    request.body.projectRevision as number
  );
  sendData(response, result, { message: 'Scene deleted.' });
}

export async function addHotspot(request: Request, response: Response): Promise<void> {
  const result = await createHotspot(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    ownerId(request),
    request.body
  );
  sendData(response, result, { status: 201, message: 'Hotspot created.' });
}

export async function patchHotspot(request: Request, response: Response): Promise<void> {
  const result = await updateHotspot(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    routeParam(request, 'hotspotId'),
    ownerId(request),
    request.body
  );
  sendData(response, result, { message: 'Hotspot saved.' });
}

export async function removeHotspot(request: Request, response: Response): Promise<void> {
  const result = await deleteHotspot(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    routeParam(request, 'hotspotId'),
    ownerId(request),
    request.body.projectRevision as number
  );
  sendData(response, result, { message: 'Hotspot deleted.' });
}
