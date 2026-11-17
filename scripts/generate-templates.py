"""Developer utility. Build only piece-shape feature templates from a chessboard screenshot.
No usernames, timestamps, or full screenshots are included in the output.
"""
from PIL import Image
import numpy as np, json, sys
source=sys.argv[1] if len(sys.argv)>1 else '/mnt/data/IMG_2563.png'
output=sys.argv[2] if len(sys.argv)>2 else 'public/templates/pieces.json'
img=Image.open(source).convert('RGB')
# Calibration of supplied Chess.com screenshot (1179 x 2556), black at bottom.
board_left=0; board_top=759; board_size=1178
locs={'R':(0,0),'N':(1,0),'B':(2,0),'K':(3,0),'Q':(4,0),'P':(0,1),'r':(0,7),'n':(1,7),'b':(2,7),'k':(3,7),'q':(4,7),'p':(0,6)}
N=48
out={}
for piece,(x,y) in locs.items():
    tile=board_size/8
    crop=img.crop((round(board_left+x*tile),round(board_top+y*tile),round(board_left+(x+1)*tile),round(board_top+(y+1)*tile)))
    arr=np.asarray(crop.resize((N,N),Image.Resampling.BILINEAR),dtype=np.float32)
    corners=np.concatenate([arr[:4,:4].reshape(-1,3),arr[:4,-4:].reshape(-1,3),arr[-4:,:4].reshape(-1,3),arr[-4:,-4:].reshape(-1,3)])
    bg=np.median(corners,axis=0)
    dist=np.sqrt(np.sum((arr-bg)**2,axis=2))
    mask=(dist>28).astype(np.uint8)
    mask[:5,:]=0;mask[-5:,:]=0;mask[:,:5]=0;mask[:,-5:]=0
    bright=float(np.median(arr[mask>0].mean(axis=1)))
    out[piece]={'mask':''.join(str(int(v)) for v in mask.flatten()),'bright':round(bright,2),'area':int(mask.sum())}
with open(output,'w') as f: json.dump({'size':N,'pieces':out},f,separators=(',',':'))
print('Wrote',output)