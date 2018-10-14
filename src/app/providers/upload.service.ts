import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import * as qiniu from 'qiniu-js';
import { from, Observable, of, Subject } from 'rxjs';
import { catchError, delay, filter, map, mergeMap, mergeMapTo, take, takeUntil, timeout } from 'rxjs/operators';

import { ALLOW_UPLOAD_FILE_TYPES, CRUDVar, QiniuErrorCode } from '../constant/constant';
import { GetQiniuTokenResponse } from '../interface/response.interface';
import { BaseService } from './base.service';

export interface UploadResult {
    name: string;
    url: string;
}

@Injectable()
export class UploadService extends BaseService {
    private readonly path = 'upload';

    uploading$: Subject<boolean> = new Subject();

    uploadedCount = 0;

    uploadTotal = 0;

    private readonly urlPrefix = 'http://pghicsch6.bkt.clouddn.com/';

    result$: Subject<UploadResult[]> = new Subject();

    constructor(private _http: HttpClient, private _snack: MatSnackBar) {
        super();
    }

    private getUploadToken(name: string): Observable<string> {
        return this._http
            .post<GetQiniuTokenResponse>(this.completeApiUrl(this.path, CRUDVar.CREATE), { name })
            .pipe(map(res => res.uploadToken));
    }

    /**
     * Upload file to qiniu server;
     * 1、获取token
     * 2、上传图片
     * 3、图片全部上传完成时发出上传结果
     * 4、发生错误或完成时终止数据流
     */
    uploadImage(files: FileList): Observable<UploadResult[]> {
        this.uploading$.next(true);

        this.uploadTotal = files.length;

        return from(files).pipe(
            delay(100),
            mergeMap((file, index) =>
                this.getUploadToken(file.name).pipe(
                    map(token => ({
                        index,
                        obs: qiniu.upload(
                            file,
                            file.name,
                            token,
                            { useCdnDomain: true },
                            { mimeType: ALLOW_UPLOAD_FILE_TYPES },
                        ),
                    })),
                ),
            ),
            timeout(1000),
            map(engine => engine.obs.subscribe(this.createUploadObserver(engine.index))),
            mergeMapTo(this.result$.asObservable()),
            takeUntil(
                this.uploading$.pipe(
                    filter(uploading => !uploading),
                    take(1),
                ),
            ),
            catchError(err => {
                this.tokenError(err);

                return of(null);
            }),
        );
    }

    private tokenError(err: any): void {
        this.reset();

        this._snack.open(`上传失败或请求超时！错误原因：${err.message}`, '', this.snakeBarConfig);
    }

    /**
     * Get upload image observer;
     */
    private createUploadObserver(index: number): Qiniu.Observer {
        let results: UploadResult[] = [];

        const clear = () => {
            this.reset();
            results = [];
        };

        return {
            next: _ => {},
            error: ({ code }: Qiniu.Error) => {
                this._snack.open(
                    `第${index + 1}张图片上传失败，失败原因：` + QiniuErrorCode[code],
                    '',
                    this.snakeBarConfig,
                );
                clear();
            },
            complete: obj => {
                results = [...results, { url: this.urlPrefix + obj.key, name: obj.key }];

                this.uploadedCount += 1;

                if (this.uploadedCount === this.uploadTotal) {
                    this.result$.next([...results]);
                    clear();
                    this._snack.open('图片上传成功', '', this.snakeBarConfig);
                }
            },
        };
    }

    private reset(): void {
        this.uploading$.next(false);

        this.uploadedCount = 0;

        this.uploadTotal = 0;
    }
}