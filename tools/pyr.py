import os,numpy as np
from PIL import Image
OUT="out/plan-tiles"
import sys
ZFROM,ZTO=int(sys.argv[1]),int(sys.argv[2])
for z in range(ZFROM,ZTO,-1):
    kids={}
    for x in os.listdir(f'{OUT}/{z+1}'):
        for f in os.listdir(f'{OUT}/{z+1}/{x}'):
            y=int(f.split('.')[0]); kids.setdefault((int(x)//2,y//2),[]).append((int(x),y))
    for (px,py),ch in kids.items():
        can=np.zeros((512,512,4),np.float32)
        for (x,y) in ch:
            a=np.array(Image.open(f'{OUT}/{z+1}/{x}/{y}.webp').convert('RGBA')).astype(np.float32)
            a[...,:3]*=a[...,3:4]/255
            can[(y%2)*256:(y%2)*256+256,(x%2)*256:(x%2)*256+256]=a
        im=can.reshape(256,2,256,2,4).mean(axis=(1,3))
        al=im[...,3:4]; rgb=np.where(al>0,im[...,:3]/np.maximum(al/255,1e-6),0)
        o=np.concatenate([np.clip(rgb,0,255),al],axis=2).astype(np.uint8)
        os.makedirs(f'{OUT}/{z}/{px}',exist_ok=True)
        Image.fromarray(o).save(f'{OUT}/{z}/{px}/{py}.webp','WEBP',quality=85,method=4)
    print(z,len(kids))
