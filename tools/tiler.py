import pypdfium2 as pdfium, numpy as np, json, math, os, cv2, sys
from PIL import Image
T=json.load(open('T.json')); R=6378137; C=2*math.pi*R
X0,Y0,X1,Y1=140,1880,1810,3240
ZMAX=int(sys.argv[1]) if len(sys.argv)>1 else 19; S=float(sys.argv[2]) if len(sys.argv)>2 else 10
OUT='out/plan-tiles'
pdf=pdfium.PdfDocument('map.pdf'); page=pdf[0]; page.set_rotation(0); PW,PH=page.get_size()
A=np.array([[T['a'],T['b'],T['c']],[T['d'],T['e'],T['f']],[0,0,1]])  # plan -> merc
Ai=np.linalg.inv(A)
def merc2px(z): # merc -> global pixel at zoom z
    k=256*2**z/C; return np.array([[k,0,k*C/2],[0,-k,k*C/2],[0,0,1]])
P2px=merc2px(ZMAX)@A; px2P=np.linalg.inv(P2px)
corners=np.array([[X0,Y0,1],[X1,Y0,1],[X1,Y1,1],[X0,Y1,1]]).T
pc=P2px@corners
tx0,tx1=int(pc[0].min()//256),int(pc[0].max()//256); ty0,ty1=int(pc[1].min()//256),int(pc[1].max()//256)
print('z',ZMAX,'tiles x',tx0,tx1,'y',ty0,ty1)
B=8; n=0; os.makedirs(OUT,exist_ok=True)
for bx in range(tx0//B, tx1//B+1):
  for by in range(ty0//B, ty1//B+1):
    gx,gy=bx*B*256,by*B*256; size=B*256
    q=px2P@np.array([[gx,gx+size,gx+size,gx],[gy,gy,gy+size,gy+size],[1,1,1,1]])
    m=12
    x0,x1=max(X0,q[0].min()-m),min(X1,q[0].max()+m); y0,y1=max(Y0,q[1].min()-m),min(Y1,q[1].max()+m)
    if x1-x0<2 or y1-y0<2: continue
    img=page.render(scale=S,crop=(x0,y0,PW-x1,PH-y1),fill_color=(255,255,255,0),draw_annots=False,may_draw_forms=False).to_pil().convert('RGBA')
    a=np.array(img); rgb=a[...,:3].astype(np.int16); white=rgb.min(axis=2)>242; a[white,3]=0
    # premultiply
    al=a[...,3:4].astype(np.float32)/255; pm=np.concatenate([a[...,:3]*al,al*255],axis=2).astype(np.float32)
    # block pixel -> plan -> render pixel (u=(x-x0)*S, v=(y1-y)*S)
    P2r=np.array([[S,0,-x0*S],[0,-S,y1*S],[0,0,1]])
    M=(P2r@px2P@np.array([[1,0,gx],[0,1,gy],[0,0,1]]))[:2]
    w=cv2.warpAffine(pm,M,(size,size),flags=cv2.INTER_AREA|cv2.WARP_INVERSE_MAP if False else cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0,0))
    alpha=w[...,3:4]; rgbo=np.where(alpha>0, w[...,:3]/np.maximum(alpha/255,1e-6),0)
    out=np.concatenate([np.clip(rgbo,0,255),alpha],axis=2).astype(np.uint8)
    for i in range(B):
      for j in range(B):
        t=out[j*256:(j+1)*256,i*256:(i+1)*256]
        if t[...,3].max()<8: continue
        d=f'{OUT}/{ZMAX}/{bx*B+i}'; os.makedirs(d,exist_ok=True)
        Image.fromarray(t).save(f'{d}/{by*B+j}.webp','WEBP',quality=82,method=4)
        n+=1
print('tiles',n)
